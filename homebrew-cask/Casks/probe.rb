cask "probe" do
  version "0.0.3"
  sha256 :no_check

  url "https://github.com/ChickmagnetL/Probe/releases/download/v#{version}/Probe_#{version}_aarch64.dmg"
  name "Probe"
  desc "AI-powered codebase analysis tool"
  homepage "https://github.com/ChickmagnetL/Probe"

  depends_on macos: :big_sur

  app "Probe.app"

  # 未签名应用若带 com.apple.quarantine 会被 Gatekeeper 判为"已损坏"，
  # 安装后主动剥离该属性，用户无需任何额外操作即可打开。
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-r", "-d", "com.apple.quarantine", "/Applications/Probe.app"]
  end

  zap trash: [
    "~/Library/Application Support/com.probe.desktop",
    "~/Library/Caches/com.probe.desktop",
    "~/Library/HTTPStorages/com.probe.desktop",
    "~/Library/WebKit/com.probe.desktop",
  ]
end
