#define WIN32_LEAN_AND_MEAN

#include <windows.h>
#include <bcrypt.h>
#include <shellapi.h>
#include <shlwapi.h>
#include <wincrypt.h>

#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

#define CONFIG_MAX_BYTES (128 * 1024)
#define MAX_BASE64_PATH_BYTES (96 * 1024)
#define MAX_HASHED_FILE_BYTES (8 * 1024 * 1024)
#define SHA256_HEX_LENGTH 64

typedef struct LauncherConfig {
  char node_path_base64[MAX_BASE64_PATH_BYTES];
  char entrypoint_path_base64[MAX_BASE64_PATH_BYTES];
  char package_digest[SHA256_HEX_LENGTH + 1];
  char prebuilt_digest[SHA256_HEX_LENGTH + 1];
} LauncherConfig;

typedef struct WideBuffer {
  wchar_t *data;
  size_t length;
  size_t capacity;
} WideBuffer;

static const char CONFIG_PREFIX[] =
    "{\"version\":1,\"ownerMarker\":\"syncnoscli-runtime-v1\",\"nodePathBase64\":\"";
static const char CONFIG_ENTRYPOINT[] = "\",\"entrypointPathBase64\":\"";
static const char CONFIG_PACKAGE_DIGEST[] = "\",\"packageDigest\":\"";
static const char CONFIG_PREBUILT_DIGEST[] = "\",\"prebuiltDigest\":\"";
static const char CONFIG_SUFFIX[] = "\"}";

static BOOL is_base64_character(char value) {
  return (value >= 'A' && value <= 'Z') || (value >= 'a' && value <= 'z') ||
         (value >= '0' && value <= '9') || value == '+' || value == '/' || value == '=';
}

static BOOL is_lower_hex_character(char value) {
  return (value >= '0' && value <= '9') || (value >= 'a' && value <= 'f');
}

static BOOL consume_literal(const char **cursor, const char *literal) {
  const size_t length = strlen(literal);
  if (strncmp(*cursor, literal, length) != 0) return FALSE;
  *cursor += length;
  return TRUE;
}

static BOOL consume_base64(const char **cursor, char *destination, size_t destination_size) {
  size_t length = 0;
  while (is_base64_character(**cursor)) {
    if (length + 1 >= destination_size) return FALSE;
    destination[length++] = **cursor;
    *cursor += 1;
  }
  if (length == 0 || **cursor != '\"') return FALSE;
  destination[length] = '\0';
  return TRUE;
}

static BOOL consume_digest(const char **cursor, char destination[SHA256_HEX_LENGTH + 1]) {
  size_t index = 0;
  for (; index < SHA256_HEX_LENGTH; index += 1) {
    if (!is_lower_hex_character((*cursor)[index])) return FALSE;
    destination[index] = (*cursor)[index];
  }
  if ((*cursor)[SHA256_HEX_LENGTH] != '\"') return FALSE;
  destination[SHA256_HEX_LENGTH] = '\0';
  *cursor += SHA256_HEX_LENGTH;
  return TRUE;
}

static BOOL parse_launcher_config(const char *input, LauncherConfig *config) {
  const char *cursor = input;
  if (!consume_literal(&cursor, CONFIG_PREFIX) ||
      !consume_base64(&cursor, config->node_path_base64, sizeof(config->node_path_base64)) ||
      !consume_literal(&cursor, CONFIG_ENTRYPOINT) ||
      !consume_base64(&cursor, config->entrypoint_path_base64, sizeof(config->entrypoint_path_base64)) ||
      !consume_literal(&cursor, CONFIG_PACKAGE_DIGEST) ||
      !consume_digest(&cursor, config->package_digest) ||
      !consume_literal(&cursor, CONFIG_PREBUILT_DIGEST) ||
      !consume_digest(&cursor, config->prebuilt_digest) || !consume_literal(&cursor, CONFIG_SUFFIX)) {
    return FALSE;
  }
  return *cursor == '\0';
}

static BOOL file_is_regular(const wchar_t *path) {
  const DWORD attributes = GetFileAttributesW(path);
  return attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY) == 0 &&
         (attributes & FILE_ATTRIBUTE_REPARSE_POINT) == 0;
}

static wchar_t *get_module_path(void) {
  DWORD capacity = MAX_PATH;
  while (capacity <= 32768) {
    wchar_t *path = (wchar_t *)calloc(capacity, sizeof(wchar_t));
    if (!path) return NULL;
    const DWORD length = GetModuleFileNameW(NULL, path, capacity);
    if (length > 0 && length < capacity - 1) return path;
    free(path);
    if (capacity > 16384) break;
    capacity *= 2;
  }
  return NULL;
}

static wchar_t *owned_runtime_parent(const wchar_t *module_path) {
  wchar_t *parent = _wcsdup(module_path);
  if (!parent) return NULL;
  wchar_t *separator = wcsrchr(parent, L'\\');
  if (!separator) {
    free(parent);
    return NULL;
  }
  *separator = L'\0';
  separator = wcsrchr(parent, L'\\');
  if (!separator || _wcsicmp(separator + 1, L".syncnoscli") != 0) {
    free(parent);
    return NULL;
  }
  const DWORD attributes = GetFileAttributesW(parent);
  if (attributes == INVALID_FILE_ATTRIBUTES || (attributes & FILE_ATTRIBUTE_DIRECTORY) == 0 ||
      (attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0) {
    free(parent);
    return NULL;
  }
  return parent;
}

static wchar_t *join_path(const wchar_t *parent, const wchar_t *name) {
  const size_t parent_length = wcslen(parent);
  const size_t name_length = wcslen(name);
  wchar_t *joined = (wchar_t *)calloc(parent_length + name_length + 2, sizeof(wchar_t));
  if (!joined) return NULL;
  memcpy(joined, parent, parent_length * sizeof(wchar_t));
  joined[parent_length] = L'\\';
  memcpy(joined + parent_length + 1, name, (name_length + 1) * sizeof(wchar_t));
  return joined;
}

static BOOL read_small_file(const wchar_t *path, char **contents) {
  *contents = NULL;
  if (!file_is_regular(path)) return FALSE;
  HANDLE handle = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING,
                              FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
  if (handle == INVALID_HANDLE_VALUE) return FALSE;

  LARGE_INTEGER size;
  const BOOL has_size = GetFileSizeEx(handle, &size);
  if (!has_size || size.QuadPart <= 0 || size.QuadPart > CONFIG_MAX_BYTES) {
    CloseHandle(handle);
    return FALSE;
  }

  const DWORD expected = (DWORD)size.QuadPart;
  char *buffer = (char *)calloc((size_t)expected + 1, sizeof(char));
  if (!buffer) {
    CloseHandle(handle);
    return FALSE;
  }
  DWORD read = 0;
  const BOOL read_ok = ReadFile(handle, buffer, expected, &read, NULL);
  CloseHandle(handle);
  if (!read_ok || read != expected) {
    free(buffer);
    return FALSE;
  }
  buffer[expected] = '\0';
  *contents = buffer;
  return TRUE;
}

static wchar_t *decode_base64_utf8_path(const char *base64) {
  DWORD byte_count = 0;
  if (!CryptStringToBinaryA(base64, 0, CRYPT_STRING_BASE64, NULL, &byte_count, NULL, NULL) || byte_count == 0) {
    return NULL;
  }
  BYTE *bytes = (BYTE *)calloc(byte_count, sizeof(BYTE));
  if (!bytes) return NULL;
  if (!CryptStringToBinaryA(base64, 0, CRYPT_STRING_BASE64, bytes, &byte_count, NULL, NULL)) {
    free(bytes);
    return NULL;
  }
  for (DWORD index = 0; index < byte_count; index += 1) {
    if (bytes[index] == 0) {
      free(bytes);
      return NULL;
    }
  }
  const int wide_length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, (const char *)bytes, (int)byte_count,
                                               NULL, 0);
  if (wide_length <= 0) {
    free(bytes);
    return NULL;
  }
  wchar_t *path = (wchar_t *)calloc((size_t)wide_length + 1, sizeof(wchar_t));
  if (!path) {
    free(bytes);
    return NULL;
  }
  const int converted = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, (const char *)bytes, (int)byte_count,
                                             path, wide_length);
  free(bytes);
  if (converted != wide_length || PathIsRelativeW(path)) {
    free(path);
    return NULL;
  }
  return path;
}

static BOOL canonical_absolute_path(const wchar_t *path) {
  if (PathIsRelativeW(path)) return FALSE;
  const DWORD required = GetFullPathNameW(path, 0, NULL, NULL);
  if (required == 0 || required > 32768) return FALSE;
  wchar_t *normalized = (wchar_t *)calloc(required + 1, sizeof(wchar_t));
  if (!normalized) return FALSE;
  const DWORD result = GetFullPathNameW(path, required + 1, normalized, NULL);
  const BOOL matches = result > 0 && result < required + 1 && _wcsicmp(path, normalized) == 0;
  free(normalized);
  return matches;
}

static BOOL has_suffix_case_insensitive(const wchar_t *value, const wchar_t *suffix) {
  const size_t value_length = wcslen(value);
  const size_t suffix_length = wcslen(suffix);
  return value_length >= suffix_length && _wcsicmp(value + value_length - suffix_length, suffix) == 0;
}

static wchar_t *derive_package_root(const wchar_t *entrypoint_path) {
  static const wchar_t entrypoint_suffix[] = L"\\dist\\native-host.cjs";
  if (!has_suffix_case_insensitive(entrypoint_path, entrypoint_suffix)) return NULL;
  const size_t root_length = wcslen(entrypoint_path) - wcslen(entrypoint_suffix);
  if (root_length == 0) return NULL;
  wchar_t *root = (wchar_t *)calloc(root_length + 1, sizeof(wchar_t));
  if (!root) return NULL;
  memcpy(root, entrypoint_path, root_length * sizeof(wchar_t));
  root[root_length] = L'\0';
  wchar_t *package_json = join_path(root, L"package.json");
  const BOOL valid = package_json && file_is_regular(package_json);
  free(package_json);
  if (!valid) {
    free(root);
    return NULL;
  }
  return root;
}

static BOOL sha256_file(const wchar_t *path, char output[SHA256_HEX_LENGTH + 1]) {
  if (!file_is_regular(path)) return FALSE;
  HANDLE handle = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING,
                              FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
  if (handle == INVALID_HANDLE_VALUE) return FALSE;
  LARGE_INTEGER size;
  if (!GetFileSizeEx(handle, &size) || size.QuadPart <= 0 || size.QuadPart > MAX_HASHED_FILE_BYTES) {
    CloseHandle(handle);
    return FALSE;
  }

  BCRYPT_ALG_HANDLE algorithm = NULL;
  BCRYPT_HASH_HANDLE hash = NULL;
  DWORD object_length = 0;
  DWORD hash_length = 0;
  DWORD bytes_written = 0;
  PUCHAR object = NULL;
  UCHAR digest[32];
  BOOL success = FALSE;

  if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, NULL, 0) != 0 ||
      BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, (PUCHAR)&object_length, sizeof(object_length),
                        &bytes_written, 0) != 0 ||
      BCryptGetProperty(algorithm, BCRYPT_HASH_LENGTH, (PUCHAR)&hash_length, sizeof(hash_length), &bytes_written,
                        0) != 0 ||
      hash_length != sizeof(digest)) {
    goto cleanup;
  }
  object = (PUCHAR)calloc(object_length, sizeof(UCHAR));
  if (!object || BCryptCreateHash(algorithm, &hash, object, object_length, NULL, 0, 0) != 0) goto cleanup;

  UCHAR buffer[32768];
  for (;;) {
    DWORD read = 0;
    if (!ReadFile(handle, buffer, sizeof(buffer), &read, NULL)) goto cleanup;
    if (read == 0) break;
    if (BCryptHashData(hash, buffer, read, 0) != 0) goto cleanup;
  }
  if (BCryptFinishHash(hash, digest, sizeof(digest), 0) != 0) goto cleanup;
  static const char hex[] = "0123456789abcdef";
  for (size_t index = 0; index < sizeof(digest); index += 1) {
    output[index * 2] = hex[digest[index] >> 4];
    output[index * 2 + 1] = hex[digest[index] & 0x0f];
  }
  output[SHA256_HEX_LENGTH] = '\0';
  success = TRUE;

cleanup:
  if (hash) BCryptDestroyHash(hash);
  if (algorithm) BCryptCloseAlgorithmProvider(algorithm, 0);
  free(object);
  CloseHandle(handle);
  return success;
}

static BOOL wide_buffer_reserve(WideBuffer *buffer, size_t extra) {
  if (buffer->length + extra + 1 <= buffer->capacity) return TRUE;
  size_t next_capacity = buffer->capacity ? buffer->capacity : 512;
  while (next_capacity < buffer->length + extra + 1) {
    if (next_capacity >= 32768) return FALSE;
    next_capacity *= 2;
  }
  wchar_t *next = (wchar_t *)realloc(buffer->data, next_capacity * sizeof(wchar_t));
  if (!next) return FALSE;
  buffer->data = next;
  buffer->capacity = next_capacity;
  return TRUE;
}

static BOOL wide_buffer_append_character(WideBuffer *buffer, wchar_t value) {
  if (!wide_buffer_reserve(buffer, 1)) return FALSE;
  buffer->data[buffer->length++] = value;
  buffer->data[buffer->length] = L'\0';
  return TRUE;
}

static BOOL wide_buffer_append_repeated(WideBuffer *buffer, wchar_t value, size_t count) {
  if (!wide_buffer_reserve(buffer, count)) return FALSE;
  for (size_t index = 0; index < count; index += 1) buffer->data[buffer->length + index] = value;
  buffer->length += count;
  buffer->data[buffer->length] = L'\0';
  return TRUE;
}

static BOOL wide_buffer_append_quoted_argument(WideBuffer *buffer, const wchar_t *value) {
  if (!wide_buffer_append_character(buffer, L'\"')) return FALSE;
  size_t slash_count = 0;
  for (const wchar_t *cursor = value; *cursor; cursor += 1) {
    if (*cursor == L'\\') {
      slash_count += 1;
      continue;
    }
    if (*cursor == L'\"') {
      if (!wide_buffer_append_repeated(buffer, L'\\', slash_count * 2 + 1) ||
          !wide_buffer_append_character(buffer, L'\"')) {
        return FALSE;
      }
      slash_count = 0;
      continue;
    }
    if (!wide_buffer_append_repeated(buffer, L'\\', slash_count) ||
        !wide_buffer_append_character(buffer, *cursor)) {
      return FALSE;
    }
    slash_count = 0;
  }
  return wide_buffer_append_repeated(buffer, L'\\', slash_count * 2) &&
         wide_buffer_append_character(buffer, L'\"');
}

static DWORD launch_node(const wchar_t *node_path, const wchar_t *entrypoint_path, const wchar_t *package_root) {
  int argument_count = 0;
  LPWSTR *arguments = CommandLineToArgvW(GetCommandLineW(), &argument_count);
  if (!arguments || argument_count < 1) return ERROR_INVALID_DATA;

  WideBuffer command = {0};
  BOOL command_ok = wide_buffer_append_quoted_argument(&command, node_path) &&
                    wide_buffer_append_character(&command, L' ') &&
                    wide_buffer_append_quoted_argument(&command, entrypoint_path);
  for (int index = 1; command_ok && index < argument_count; index += 1) {
    command_ok = wide_buffer_append_character(&command, L' ') &&
                 wide_buffer_append_quoted_argument(&command, arguments[index]);
  }
  LocalFree(arguments);
  if (!command_ok) {
    free(command.data);
    return ERROR_BUFFER_OVERFLOW;
  }

  STARTUPINFOW startup = {0};
  startup.cb = sizeof(startup);
  startup.dwFlags = STARTF_USESTDHANDLES;
  startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
  startup.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
  startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
  PROCESS_INFORMATION process = {0};
  const BOOL created = CreateProcessW(node_path, command.data, NULL, NULL, TRUE, 0, NULL, package_root, &startup, &process);
  free(command.data);
  if (!created) return GetLastError();

  const DWORD waited = WaitForSingleObject(process.hProcess, INFINITE);
  DWORD exit_code = ERROR_PROCESS_ABORTED;
  if (waited == WAIT_OBJECT_0 && !GetExitCodeProcess(process.hProcess, &exit_code)) exit_code = GetLastError();
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  return exit_code;
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE previous_instance, PWSTR command_line, int show_command) {
  (void)instance;
  (void)previous_instance;
  (void)command_line;
  (void)show_command;

  int exit_code = ERROR_INVALID_DATA;
  wchar_t *module_path = get_module_path();
  wchar_t *runtime_directory = NULL;
  wchar_t *config_path = NULL;
  char *config_bytes = NULL;
  wchar_t *node_path = NULL;
  wchar_t *entrypoint_path = NULL;
  wchar_t *package_root = NULL;
  LauncherConfig config = {0};
  char actual_prebuilt_digest[SHA256_HEX_LENGTH + 1];
  char actual_package_digest[SHA256_HEX_LENGTH + 1];

  if (!module_path || !file_is_regular(module_path)) goto cleanup;
  runtime_directory = owned_runtime_parent(module_path);
  if (!runtime_directory) goto cleanup;
  config_path = join_path(runtime_directory, L"native-host-launcher-v1.json");
  if (!config_path || !read_small_file(config_path, &config_bytes) || !parse_launcher_config(config_bytes, &config)) goto cleanup;
  node_path = decode_base64_utf8_path(config.node_path_base64);
  entrypoint_path = decode_base64_utf8_path(config.entrypoint_path_base64);
  if (!node_path || !entrypoint_path || !canonical_absolute_path(node_path) ||
      !canonical_absolute_path(entrypoint_path) || !file_is_regular(node_path) || !file_is_regular(entrypoint_path)) {
    goto cleanup;
  }
  package_root = derive_package_root(entrypoint_path);
  if (!package_root || !sha256_file(module_path, actual_prebuilt_digest) ||
      !sha256_file(entrypoint_path, actual_package_digest) ||
      strcmp(actual_prebuilt_digest, config.prebuilt_digest) != 0 ||
      strcmp(actual_package_digest, config.package_digest) != 0) {
    goto cleanup;
  }
  exit_code = (int)launch_node(node_path, entrypoint_path, package_root);

cleanup:
  free(package_root);
  free(entrypoint_path);
  free(node_path);
  free(config_bytes);
  free(config_path);
  free(runtime_directory);
  free(module_path);
  return exit_code;
}
