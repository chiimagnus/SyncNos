class Syncbooknotes < Formula
  desc "CLI tool to export Apple Books highlights and notes"
  homepage "https://github.com/chiimagnus/SyncBookNotesWithNotion"
  url "https://github.com/chiimagnus/SyncBookNotesWithNotion/archive/v0.1.0.tar.gz"
  sha256 "YOUR_SHA256_HASH_HERE"
  license "GPL-3.0"

  depends_on :macos => :ventura # macOS 13+
  depends_on "xcode" => :build

  def install
    # Build the CLI tool using xcodebuild
    system "xcodebuild", "-project", "SyncBookNotesWithNotion.xcodeproj", 
                         "-scheme", "CLI", 
                         "-configuration", "Release", 
                         "-derivedDataPath", "build",
                         "BUILD_DIR=build"

    # Install the binary
    bin.install "build/Build/Products/Release/CLI" => "syncbooknotes"
    
    # Create symlink for sbn command
    bin.install_symlink "syncbooknotes" => "sbn"
  end

  test do
    # Test that the CLI tool runs
    assert_match "Books data root", shell_output("#{bin}/syncbooknotes inspect", 0)
  end
end