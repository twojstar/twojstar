using PaintDotNet.FileTypes;

namespace Travny.PaintDotNetIco;

public sealed class IcoFileTypeFactoryModern : IFileTypeFactory
{
    public IFileType[] CreateFileTypes(IFileTypeHost host) =>
        new IFileType[] { new IcoFileTypeModern(host) };
}
