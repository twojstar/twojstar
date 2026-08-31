using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;

namespace Travny.PaintDotNetIco;

internal sealed record IcoFrame(
    int Index,
    int Width,
    int Height,
    byte ColorCount,
    byte Reserved,
    ushort Planes,
    ushort BitCount,
    int DataLength,
    long DataOffset,
    bool IsPng)
{
    public long Score => ((long)Width * Height << 16) + BitCount;
}

internal sealed class IcoDocument : IDisposable
{
    private readonly Stream input;
    private readonly bool ownsInput;
    private readonly Dictionary<(long Offset, int Length), bool> decodeCache = new();

    public IcoDocument(Stream input, IReadOnlyList<IcoFrame> frames, bool ownsInput)
    {
        this.input = input;
        this.ownsInput = ownsInput;
        Frames = frames;
    }
    public IReadOnlyList<IcoFrame> Frames { get; }

    public int FindDefaultFrameIndex()
    {
        foreach ((IcoFrame frame, int index) in Frames
                     .Select((frame, index) => (frame, index))
                     .OrderByDescending(item => item.frame.Score))
        {
            if (CanDecode(frame))
            {
                return index;
            }
        }

        throw new InvalidDataException("ICO contains no decodable images.");
    }

    public bool CanDecode(IcoFrame frame)
    {
        var key = (frame.DataOffset, frame.DataLength);
        if (decodeCache.TryGetValue(key, out bool cached))
        {
            return cached;
        }

        try
        {
            using Bitmap bitmap = Decode(frame);
            bool result = bitmap.Width == frame.Width && bitmap.Height == frame.Height;
            decodeCache[key] = result;
            return result;
        }
        catch (Exception ex) when (IsDecodeFailure(ex))
        {
            decodeCache[key] = false;
            return false;
        }
    }

    public Bitmap Decode(IcoFrame frame)
    {
        if (frame.IsPng)
        {
            byte[] payload = ReadPayload(frame);
            using var stream = new MemoryStream(payload, writable: false);
            try
            {
                using var decoded = new Bitmap(stream);
                return new Bitmap(decoded);
            }
            catch (ArgumentException ex)
            {
                throw new InvalidDataException("ICO PNG frame could not be decoded.", ex);
            }
        }

        using MemoryStream singleIcon = BuildSingleEntryIcon(frame);
        try
        {
            using var icon = new Icon(singleIcon);
            using Bitmap decodedIcon = icon.ToBitmap();
            return new Bitmap(decodedIcon);
        }
        catch (ArgumentException ex)
        {
            throw new InvalidDataException("ICO bitmap frame could not be decoded.", ex);
        }
    }

    private byte[] ReadPayload(IcoFrame frame)
    {
        byte[] payload = new byte[frame.DataLength];
        input.Position = frame.DataOffset;
        input.ReadExactly(payload);
        return payload;
    }

    private MemoryStream BuildSingleEntryIcon(IcoFrame frame)
    {
        var output = new MemoryStream(22 + frame.DataLength);
        using var writer = new BinaryWriter(output, System.Text.Encoding.UTF8, leaveOpen: true);
        writer.Write((ushort)0);
        writer.Write((ushort)1);
        writer.Write((ushort)1);
        writer.Write((byte)(frame.Width == 256 ? 0 : frame.Width));
        writer.Write((byte)(frame.Height == 256 ? 0 : frame.Height));
        writer.Write(frame.ColorCount);
        writer.Write(frame.Reserved);
        writer.Write(frame.Planes);
        writer.Write(frame.BitCount);
        writer.Write((uint)frame.DataLength);
        writer.Write((uint)22);
        writer.Flush();

        input.Position = frame.DataOffset;
        CopyExactly(input, output, frame.DataLength);
        output.Position = 0;
        return output;
    }
    private static void CopyExactly(Stream input, Stream output, int bytesToCopy)
    {
        byte[] buffer = new byte[Math.Min(81920, bytesToCopy)];
        int remaining = bytesToCopy;
        while (remaining > 0)
        {
            int read = input.Read(buffer, 0, Math.Min(buffer.Length, remaining));
            if (read == 0)
            {
                throw new EndOfStreamException();
            }

            output.Write(buffer, 0, read);
            remaining -= read;
        }
    }

    private static bool IsDecodeFailure(Exception ex) =>
        ex is ExternalException
            or EndOfStreamException
            or InvalidDataException;

    public void Dispose()
    {
        if (ownsInput)
        {
            input.Dispose();
        }
    }
}

internal static class IcoDecoder
{
    private const int MaxEntries = 1024;
    private const int MaxImageBytes = 32 * 1024 * 1024;
    private const long MaxTotalImageBytes = 64L * 1024 * 1024;
    private const long MaxTotalDecodedPixels = 16L * 1024 * 1024;
    private const long MaxBufferedInputBytes = 64L * 1024 * 1024;
    public static IcoDocument Read(Stream input)
    {
        ArgumentNullException.ThrowIfNull(input);

        if (input.CanSeek)
        {
            return CreateDocument(input, ownsInput: false);
        }

        MemoryStream buffered = BufferNonSeekable(input);
        try
        {
            return CreateDocument(buffered, ownsInput: true);
        }
        catch
        {
            buffered.Dispose();
            throw;
        }
    }

    private static IcoDocument CreateDocument(Stream input, bool ownsInput)
    {
        IReadOnlyList<IcoFrame> frames = ReadDirectory(input);
        return new IcoDocument(input, frames, ownsInput);
    }

    private static MemoryStream BufferNonSeekable(Stream input)
    {
        var output = new MemoryStream();
        byte[] buffer = new byte[81920];
        long total = 0;

        while (true)
        {
            int read = input.Read(buffer, 0, buffer.Length);
            if (read == 0) break;

            total += read;
            if (total > MaxBufferedInputBytes)
            {
                output.Dispose();
                throw new InvalidDataException("ICO input is too large to buffer safely.");
            }

            output.Write(buffer, 0, read);
        }

        output.Position = 0;
        return output;
    }

    private static IReadOnlyList<IcoFrame> ReadDirectory(Stream input)
    {
        input.Position = 0;
        Span<byte> header = stackalloc byte[6];
        input.ReadExactly(header);

        if (BinaryPrimitives.ReadUInt16LittleEndian(header) != 0 ||
            BinaryPrimitives.ReadUInt16LittleEndian(header[2..]) != 1)
        {
            throw new InvalidDataException("Not a valid Windows icon file.");
        }

        int count = BinaryPrimitives.ReadUInt16LittleEndian(header[4..]);
        if (count <= 0 || count > MaxEntries)
        {
            throw new InvalidDataException("ICO directory entry count is invalid.");
        }

        int directoryLength = checked(count * 16);
        byte[] directory = new byte[directoryLength];
        input.ReadExactly(directory);
        long minimumDataOffset = 6L + directoryLength;
        long streamLength = input.Length;
        var frames = new List<IcoFrame>(count);
        var uniquePayloads = new HashSet<(long Offset, int Length)>();
        long totalUniqueImageBytes = 0;
        long totalDecodedPixels = 0;

        for (int index = 0; index < count; index++)
        {
            int offset = index * 16;
            ReadOnlySpan<byte> entry = directory.AsSpan(offset, 16);
            int width = entry[0] == 0 ? 256 : entry[0];
            int height = entry[1] == 0 ? 256 : entry[1];
            uint rawLength = BinaryPrimitives.ReadUInt32LittleEndian(entry[8..12]);
            uint rawOffset = BinaryPrimitives.ReadUInt32LittleEndian(entry[12..16]);

            if (rawLength == 0 || rawLength > MaxImageBytes)
            {
                continue;
            }

            int dataLength = checked((int)rawLength);
            long dataOffset = rawOffset;
            if (dataOffset < minimumDataOffset || dataOffset > streamLength - dataLength)
            {
                continue;
            }

            if (!TryValidateEmbeddedDimensions(
                    input,
                    dataOffset,
                    dataLength,
                    width,
                    height,
                    out bool isPng))
            {
                continue;
            }

            if (!uniquePayloads.Add((dataOffset, dataLength)))
            {
                continue;
            }

            totalUniqueImageBytes = checked(totalUniqueImageBytes + dataLength);
            if (totalUniqueImageBytes > MaxTotalImageBytes)
            {
                throw new InvalidDataException("ICO aggregate image payload is too large to process safely.");
            }

            totalDecodedPixels = checked(totalDecodedPixels + ((long)width * height));
            if (totalDecodedPixels > MaxTotalDecodedPixels)
            {
                throw new InvalidDataException("ICO aggregate decoded pixel area is too large to process safely.");
            }

            frames.Add(new IcoFrame(
                index,
                width,
                height,
                entry[2],
                entry[3],
                BinaryPrimitives.ReadUInt16LittleEndian(entry[4..6]),
                BinaryPrimitives.ReadUInt16LittleEndian(entry[6..8]),
                dataLength,
                dataOffset,
                isPng));
        }

        if (frames.Count == 0)
        {
            throw new InvalidDataException("ICO contains no readable directory entries.");
        }

        return frames;
    }
    private static bool TryValidateEmbeddedDimensions(
        Stream input,
        long offset,
        int length,
        int directoryWidth,
        int directoryHeight,
        out bool isPng)
    {
        isPng = false;
        if (length < 8)
        {
            return false;
        }

        int prefixLength = Math.Min(length, 24);
        Span<byte> prefix = stackalloc byte[24];
        input.Position = offset;
        input.ReadExactly(prefix[..prefixLength]);

        ReadOnlySpan<byte> pngSignature = new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 };
        if (prefix[..8].SequenceEqual(pngSignature))
        {
            isPng = true;
            return ValidatePngDimensions(prefix[..prefixLength], directoryWidth, directoryHeight);
        }

        return ValidateDibDimensions(prefix[..prefixLength], directoryWidth, directoryHeight);
    }

    private static bool ValidatePngDimensions(
        ReadOnlySpan<byte> prefix,
        int directoryWidth,
        int directoryHeight)
    {
        if (prefix.Length < 24)
        {
            return false;
        }

        uint ihdrLength = BinaryPrimitives.ReadUInt32BigEndian(prefix[8..12]);
        ReadOnlySpan<byte> ihdr = new byte[] { 73, 72, 68, 82 };
        if (ihdrLength != 13 || !prefix[12..16].SequenceEqual(ihdr))
        {
            return false;
        }

        uint width = BinaryPrimitives.ReadUInt32BigEndian(prefix[16..20]);
        uint height = BinaryPrimitives.ReadUInt32BigEndian(prefix[20..24]);
        return width == (uint)directoryWidth && height == (uint)directoryHeight;
    }

    private static bool ValidateDibDimensions(
        ReadOnlySpan<byte> prefix,
        int directoryWidth,
        int directoryHeight)
    {
        if (prefix.Length < 8)
        {
            return false;
        }

        uint headerSize = BinaryPrimitives.ReadUInt32LittleEndian(prefix[..4]);
        if (headerSize == 12)
        {
            int coreWidth = BinaryPrimitives.ReadUInt16LittleEndian(prefix[4..6]);
            int coreStoredHeight = BinaryPrimitives.ReadUInt16LittleEndian(prefix[6..8]);
            return coreWidth == directoryWidth && IsValidDibHeight(coreStoredHeight, directoryHeight);
        }

        if (headerSize < 40 || prefix.Length < 12)
        {
            return false;
        }

        int dibWidth = BinaryPrimitives.ReadInt32LittleEndian(prefix[4..8]);
        int dibStoredHeight = BinaryPrimitives.ReadInt32LittleEndian(prefix[8..12]);
        if (dibWidth != directoryWidth || dibStoredHeight == int.MinValue)
        {
            return false;
        }

        return IsValidDibHeight(Math.Abs(dibStoredHeight), directoryHeight);
    }

    private static bool IsValidDibHeight(int storedHeight, int directoryHeight) =>
        storedHeight == directoryHeight || storedHeight == checked(directoryHeight * 2);
}
