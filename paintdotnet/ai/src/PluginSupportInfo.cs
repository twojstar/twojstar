using PaintDotNet;
using System;

namespace Travny.PaintDotNet.AI;

public sealed class PluginSupportInfo : IPluginSupportInfo
{
    public string DisplayName => "Paint.NET AI";
    public string Author => "trvny";
    public string Copyright => "ISC";
    public Version Version => typeof(PluginSupportInfo).Assembly.GetName().Version ?? new Version(0, 1, 0);
    public Uri WebsiteUri => new("https://github.com/twojstar/twojstar/tree/main/paintdotnet/ai");
}
