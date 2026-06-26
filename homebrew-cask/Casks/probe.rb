cask "probe" do
  version "0.0.3"
  sha256 :no_check

  url "https://github.com/ChickmagnetL/Probe/releases/download/v#{version}/Probe_#{version}_aarch64.dmg"
  name "Probe"
  desc "AI-powered codebase analysis tool"
  homepage "https://github.com/ChickmagnetL/Probe"

  depends_on macos: :big_sur

  app "Probe.app"

  zap trash: [
    "~/Library/Application Support/com.probe.desktop",
    "~/Library/Caches/com.probe.desktop",
    "~/Library/HTTPStorages/com.probe.desktop",
    "~/Library/WebKit/com.probe.desktop",
  ]
end
