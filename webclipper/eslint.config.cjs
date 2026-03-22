const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const react = require('eslint-plugin-react');
const reactHooks = require('eslint-plugin-react-hooks');
const eslintConfigPrettier = require('eslint-config-prettier');

/** @type {import("eslint").Linter.FlatConfig[]} */
module.exports = [
  {
    ignores: [
      '.output/**',
      '.wxt/**',
      'node_modules/**',
      'cloudflare-workers/**',
      'public/src/vendor/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',

      // The codebase uses `any` in DOM scraping and protocol boundary areas.
      // Keep it permissive until we have time to tighten types.
      '@typescript-eslint/no-explicit-any': 'off',

      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      '@typescript-eslint/no-unused-expressions': 'off',
      'no-useless-escape': 'off',
      'prefer-const': 'off',

      '@typescript-eslint/ban-ts-comment': 'off',
    },
  },

  {
    files: ['src/ui/**/*.{ts,tsx}', 'src/viewmodels/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['@platform', '@platform/*', '@platform/**'],
        },
      ],
    },
  },

  {
    files: ['src/services/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['@ui', '@ui/*', '@ui/**', '@viewmodels', '@viewmodels/*', '@viewmodels/**'],
        },
      ],
    },
  },

  // Bootstrap and Shadow-DOM panel mounting are glue layers that currently reuse UI modules/styles.
  // Keep them unblocked by the strict service -> ui restriction, but avoid introducing new deps elsewhere.
  {
    files: [
      'src/services/bootstrap/**/*.{ts,tsx}',
      'src/services/comments/threaded-comments-panel.ts',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },

  {
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      // Tests sometimes embed escape-heavy strings; keep the rule enabled for src when re-enabled.
      'no-useless-escape': 'off',
    },
  },

  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  eslintConfigPrettier,
];
