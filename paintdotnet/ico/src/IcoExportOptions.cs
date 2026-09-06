namespace Travny.PaintDotNetIco;

internal static class IcoExportOptions
{
    internal const string PreserveAspectRatio = "Preserve aspect ratio";

    internal static readonly (string Name, int Size)[] Sizes =
    {
        ("16 x 16", 16),
        ("20 x 20", 20),
        ("24 x 24", 24),
        ("32 x 32", 32),
        ("40 x 40", 40),
        ("48 x 48", 48),
        ("64 x 64", 64),
        ("128 x 128", 128),
        ("256 x 256", 256)
    };
}
