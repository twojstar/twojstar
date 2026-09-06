using PaintDotNet;

namespace Travny.PaintDotNetIco;

public sealed class IcoFileTypeFactory : IFileTypeFactory
{
    public FileType[] GetFileTypeInstances() => new FileType[] { new IcoFileType() };
}
