class Lumber < Formula
  desc "Read end-to-end encrypted Lumber logs in the terminal and from AI agents (MCP)"
  homepage "https://lumber.infinitetoken.com/docs/cli"
  url "https://registry.npmjs.org/@infinitetoken/lumber-cli/-/lumber-cli-0.4.0.tgz"
  sha256 "34ef244770585f437426844378575750639f45ec2701e7933b464768b18c6f7c"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec.glob("bin/*")
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/lumber --version").strip

    # The MCP server answers an agent's first request, then ends with its input
    request = <<~JSON
      {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"brew","version":"1"}}}
    JSON
    assert_match "\"serverInfo\":{\"name\":\"lumber\",\"version\":\"#{version}\"}", pipe_output("#{bin}/lumber mcp", request, 0)

    # On Linux the account key lives in the Secret Service, and a test has none: lumber has to load its keyring module,
    # say so and stop, never saving anything to a file
    assert_match "none is running here", shell_output("#{bin}/lumber status 2>&1", 1) if OS.linux?
  end
end
