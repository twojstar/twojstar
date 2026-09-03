using Feedboard.Models;
using System.Xml.Linq;

namespace Feedboard.Services;

public static class Opml
{
    public static IReadOnlyList<FeedSource> Import(string xml)
    {
        var document = XDocument.Parse(xml, LoadOptions.None);
        return document
            .Descendants()
            .Where(x => x.Name.LocalName.Equals("outline", StringComparison.OrdinalIgnoreCase))
            .Select(x => new
            {
                Url = (string?)x.Attribute("xmlUrl"),
                Title = (string?)x.Attribute("title") ?? (string?)x.Attribute("text")
            })
            .Where(x => Uri.TryCreate(x.Url, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp))
            .GroupBy(x => x.Url!, StringComparer.OrdinalIgnoreCase)
            .Select(g => new FeedSource(g.Key, g.First().Title))
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
                    new XAttribute("xmlUrl", feed.Url))));

        var document = new XDocument(
            new XDeclaration("1.0", "utf-8", null),
            new XElement("opml",
                new XAttribute("version", "2.0"),
                new XElement("head", new XElement("title", "Feedboard subscriptions")),
                body));

        return document.ToString();
    }
}
