using Feedboard.Models;
using System.Xml.Linq;

namespace Feedboard.Services;

public static class Opml
{
    public static IReadOnlyList<FeedSource> Import(string xml)
    {
        XDocument document;
        try
        {
            document = XDocument.Parse(xml, LoadOptions.None);
        }
        catch (System.Xml.XmlException ex)
        {
            throw new InvalidOperationException("The selected OPML/XML file is malformed.", ex);
        }
        return document
            .Descendants()
            .Where(x => x.Name.LocalName.Equals("outline", StringComparison.OrdinalIgnoreCase))
            .Select(ParseOutline)
            .Where(x => x is not null)
            .Select(x => x!)
            .GroupBy(x => x.Url, StringComparer.Ordinal)
            .Select(g => g.First())
            .ToList();
    }

    public static string Export(IEnumerable<FeedSource> feeds)
    {
        var body = new XElement("body",
            feeds.OrderBy(x => x.Title ?? x.Url).Select(feed =>
                new XElement("outline",
                    new XAttribute("type", "rss"),
                    new XAttribute("text", feed.Title ?? feed.Url),
                    new XAttribute("title", feed.Title ?? feed.Url),
                    new XAttribute("xmlUrl", feed.Url),
                    new XAttribute("enabled", feed.Enabled))));

        var document = new XDocument(
            new XDeclaration("1.0", "utf-8", null),
            new XElement("opml",
                new XAttribute("version", "2.0"),
                new XElement("head", new XElement("title", "Feedboard subscriptions")),
                body));

        return document.ToString();
    }

    private static FeedSource? ParseOutline(XElement element)
    {
        var rawUrl = (string?)element.Attribute("xmlUrl");
        if (!FeedUrl.TryNormalize(rawUrl, out var url)) return null;
        var title = (string?)element.Attribute("title") ?? (string?)element.Attribute("text");
        return new FeedSource(url, title, ParseEnabled((string?)element.Attribute("enabled")));
    }

    private static bool ParseEnabled(string? value) =>
        !bool.TryParse(value, out var enabled) || enabled;
}
