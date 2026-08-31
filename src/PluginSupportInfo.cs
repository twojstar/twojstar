using PaintDotNet;
using System;

namespace Travny.PaintDotNetIco;

public sealed class PluginSupportInfo : IPluginSupportInfo
{
    public string DisplayName => "ICO FileType";
    public string Author => "trvny";
    public string Copyright => "MIT";
    public Version Version => typeof(PluginSupportInfo).Assembly.GetName().Version ?? new Version(0, 2, 0);
    public Uri WebsiteUri => new("https://github.com/trvny/trvny");
}
