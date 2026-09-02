import type { AirQuality, CurrentState, FeedEntry, Warning } from "./types";

// Landing page served at GET /. The current KV snapshot is rendered into HTML
// for users and crawlers; the small client script still refreshes it in place.

const CONDITION_LABELS: Record<string, string> = {
  clear: "bezchmurnie",
  clouds: "zachmurzenie",
  fog: "mgła",
  drizzle: "mżawka",
  rain: "deszcz",
  snow: "śnieg",
  storm: "burza",
  unknown: "brak danych",
};

const SOURCE_LABELS: Record<string, string> = {
  openmeteo: "Open-Meteo",
  openweather: "OpenWeather",
  visualcrossing: "Visual Crossing",
};

const POLLEN_LABELS: Record<string, string> = {
  alder: "olcha",
  birch: "brzoza",
  grass: "trawy",
  mugwort: "bylica",
  ragweed: "ambrozja",
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fmt(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return String(Math.round(value * 10) / 10);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Warsaw",
  }).format(date);
}

function renderNow(state: CurrentState | null): {
  temp: string;
  condition: string;
  spread: string;
  metrics: string;
  source: string;
} {
  if (!state?.ensemble) {
    return {
      temp: "—",
      condition: "brak danych — czekam na pierwszy cykl",
      spread: "",
      metrics: "",
      source: "Dane odświeżają się automatycznie.",
    };
  }

  const ensemble = state.ensemble;
  const condition = CONDITION_LABELS[ensemble.condition] ?? ensemble.condition;
  const spread = ensemble.tempC.n > 1
    ? `rozrzut ${fmt(ensemble.tempC.min)}–${fmt(ensemble.tempC.max)}° · ${ensemble.tempC.n} źródła`
    : "1 źródło";
  const metrics = [
    `<span>wiatr <b>${fmt(ensemble.windMs.median)}</b> m/s</span>`,
    `<span>wilgotność <b>${fmt(ensemble.humidity.median)}</b>%</span>`,
    `<span>ciśnienie <b>${fmt(ensemble.pressureHpa.median)}</b> hPa</span>`,
    ensemble.uv?.median != null ? `<span>UV <b>${fmt(ensemble.uv.median)}</b></span>` : "",
  ].join("");

  const names = (ensemble.sources ?? []).map((source) => SOURCE_LABELS[source] ?? source).join(", ");
  const observed = formatDate(ensemble.observedAt);
  let source = names ? `Źródła: ${escapeHtml(names)}` : "";
  if (observed) {
    source += `${source ? " · " : ""}<time datetime="${escapeHtml(ensemble.observedAt)}">${escapeHtml(observed)}</time>`;
  }
  if (state.imgwStation?.tempC != null) {
    source += ` · stacja IMGW (ref.): ${fmt(state.imgwStation.tempC)}°`;
  }

  return {
    temp: `${fmt(ensemble.tempC.median)}°`,
    condition: escapeHtml(condition),
    spread: escapeHtml(spread),
    metrics,
    source,
  };
}

function renderWarnings(warnings: Warning[] | null | undefined): string {
  if (!warnings?.length) return '<p class="empty">Brak aktywnych ostrzeżeń.</p>';
  return warnings.map((warning) => {
    const cls = warning.category === "hydro" ? "hydro" : warning.level != null && warning.level >= 3 ? "alarm" : "";
    const level = warning.level != null && warning.level >= 1 ? ` (stopień ${warning.level})` : "";
    const tag = warning.category === "hydro" ? "IMGW hydro" : "IMGW";
    const range = `${warning.from ?? "?"} → ${warning.to ?? "?"}`;
    return `<div class="warn ${cls}"><div class="wt">${escapeHtml(`${tag}: ${warning.event}${level}`)}</div>`
      + `<div class="wm">${escapeHtml(warning.content)}<br>${escapeHtml(range)}</div></div>`;
  }).join("");
}

function aqiBand(value: number | null): { label: string; color: string } {
  if (value == null || !Number.isFinite(value)) return { label: "—", color: "var(--muted)" };
  const bands: Array<[number, string, string]> = [
    [20, "bardzo dobra", "#10b981"],
    [40, "dobra", "#84cc16"],
    [60, "umiarkowana", "#f59e0b"],
    [80, "zła", "#f97316"],
    [100, "bardzo zła", "#ef4444"],
    [Number.POSITIVE_INFINITY, "ekstremalnie zła", "#7f1d1d"],
  ];
  const match = bands.find(([limit]) => value <= limit) ?? bands[bands.length - 1];
  return { label: match[1], color: match[2] };
}

function renderAir(air: AirQuality | null | undefined): string {
  if (!air) return '<p class="empty">Brak danych o jakości powietrza.</p>';
  const band = aqiBand(air.europeanAqi);
  let html = `<div class="now"><span class="temp" style="color:${band.color}">${air.europeanAqi == null ? "—" : Math.round(air.europeanAqi)}</span>`
    + `<span><span class="cond" style="color:${band.color}">AQI — ${escapeHtml(band.label)}</span><br>`
    + `<span class="spread">PM2.5 ${fmt(air.pm25)} · PM10 ${fmt(air.pm10)} µg/m³</span></span></div>`;
  if (air.pollen?.length) {
    html += `<div class="metrics">${air.pollen.map((item) =>
      `<span>${escapeHtml(POLLEN_LABELS[item.species] ?? item.species)} <b>${escapeHtml(item.grains)}</b> ziaren/m³</span>`,
    ).join("")}</div>`;
    html += '<div class="src">Pyłki orientacyjnie (CAMS, ziarna/m³); europejski indeks AQI.</div>';
  } else {
    html += '<div class="src">Brak istotnych pyłków; europejski indeks AQI.</div>';
  }
  return html;
}

function renderEntries(entries: FeedEntry[]): string {
  const recent = entries.slice(0, 8);
  if (!recent.length) return '<p class="empty">Brak wpisów — czekam na pierwszą zmianę.</p>';
  return recent.map((entry) => {
    const when = formatDate(entry.published);
    return `<div class="entry"><div class="et">${escapeHtml(entry.title)}</div>`
      + `<div class="em">${escapeHtml(entry.summary)}</div>`
      + `<time datetime="${escapeHtml(entry.published)}">${escapeHtml(when)}</time></div>`;
  }).join("");
}

export function renderPage(
  origin: string,
  state: CurrentState | null = null,
  entries: FeedEntry[] = [],
): string {
  const now = renderNow(state);
  const condition = state?.ensemble
    ? CONDITION_LABELS[state.ensemble.condition] ?? state.ensemble.condition
    : null;
  const liveLead = state?.ensemble?.tempC.median != null
    ? `Aktualnie ${fmt(state.ensemble.tempC.median)}°C, ${condition}. `
    : "";
  const title = "Pogoda Chrzanów i Kościelec: temperatura, powietrze, IMGW";
  const description = `${liveLead}Pogoda dla Chrzanowa i Kościelca z mediany wielu źródeł, jakość powietrza, pyłki oraz ostrzeżenia IMGW.`;
  const schema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: title,
    description,
    url: `${origin}/`,
    inLanguage: "pl-PL",
    dateModified: state?.ensemble?.observedAt,
    spatialCoverage: {
      "@type": "Place",
      name: "Kościelec, Chrzanów",
      address: {
        "@type": "PostalAddress",
        addressLocality: "Chrzanów",
        addressRegion: "małopolskie",
        addressCountry: "PL",
      },
    },
  }).replaceAll("<", "\\u003c");

  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="google-site-verification" content="Qu5-7v2tWoKtUYUVlQXisaFkGGVEImYlmycKDUg0QBw">
<meta name="msvalidate.01" content="23A368B2C5F4DF3471A67EA6CB057149">
<meta name="robots" content="index,follow,max-image-preview:large">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="alternate" type="application/atom+xml" title="Pogoda — zmiany" href="/feed.atom">
<link rel="alternate" type="application/atom+xml" title="Ostrzeżenia IMGW" href="/warnings.atom">
<link rel="alternate" type="text/markdown" href="/index.md" title="Pogoda Chrzanów Markdown">
<link rel="describedby" href="/llms.txt" title="Pogoda Chrzanów llms.txt">
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(origin)}/">
<meta property="og:type" content="website">
<meta property="og:locale" content="pl_PL">
<meta property="og:site_name" content="Pogoda Chrzanów">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(origin)}/">
<meta property="og:image" content="${escapeHtml(origin)}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Pogoda dla Chrzanowa i Kościelca">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(origin)}/og.png">
<script type="application/ld+json">${schema}</script>
<style>
  :root{
    --ice:#d4e4f7; --steel:#4a6fa5; --steel-dark:#33507a; --silver:#c0c0c0;
    --white:#fafafa; --ink:#1a2333; --muted:#5b6678;
    --warn:#b45309; --warn-bg:#fef3c7; --alarm:#b91c1c; --alarm-bg:#fee2e2;
    --hydro:#0e7490; --hydro-bg:#cffafe;
  }
  *{box-sizing:border-box}
  body{
    margin:0; color:var(--ink); background:linear-gradient(160deg,var(--ice),var(--white) 55%);
    min-height:100vh; font-family:"DejaVu Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    line-height:1.5; -webkit-font-smoothing:antialiased;
  }
  main{max-width:680px; margin:0 auto; padding:32px 20px 56px}
  header h1{font-size:1.7rem; margin:0 0 2px; letter-spacing:-.01em}
  header h1 span{color:var(--muted);font-weight:400}
  header p{margin:0 0 22px; color:var(--muted); font-size:.95rem}
  .card{background:#fff; border:1px solid #e3eaf3; border-radius:14px; padding:20px 22px; margin:14px 0;
    box-shadow:0 1px 2px rgba(26,35,51,.04)}
  .now{display:flex; align-items:baseline; gap:14px; flex-wrap:wrap}
  .temp{font-size:3rem; font-weight:700; color:var(--steel-dark); line-height:1}
  .cond{font-size:1.1rem; color:var(--steel)}
  .spread{color:var(--muted); font-size:.9rem}
  .metrics{display:flex; gap:24px; flex-wrap:wrap; margin-top:14px; font-size:.92rem}
  .metrics b{color:var(--steel-dark)}
  .src{margin-top:12px; font-size:.8rem; color:var(--muted)}
  .btns{display:flex; gap:10px; flex-wrap:wrap; margin:8px 0 4px}
  a.btn,button.btn{
    display:inline-flex; align-items:center; gap:7px; cursor:pointer;
    font:inherit; font-weight:600; font-size:.92rem; text-decoration:none;
    padding:11px 16px; border-radius:10px; border:1px solid transparent;
  }
  a.btn.primary{background:var(--steel); color:#fff}
  a.btn.primary:hover{background:var(--steel-dark)}
  a.btn.ghost{background:#fff; color:var(--steel-dark); border-color:var(--silver)}
  a.btn.ghost:hover{border-color:var(--steel)}
  button.btn.ghost{background:#fff; color:var(--steel-dark); border-color:var(--silver)}
  h2{font-size:.85rem; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin:26px 0 6px}
  .warn{border-left:4px solid var(--warn); background:var(--warn-bg); padding:11px 14px; border-radius:8px; margin:8px 0}
  .warn.alarm{border-color:var(--alarm); background:var(--alarm-bg)}
  .warn.hydro{border-color:var(--hydro); background:var(--hydro-bg)}
  .warn .wt{font-weight:700} .warn .wm{font-size:.86rem; color:var(--muted); margin-top:2px}
  .entry{padding:10px 0; border-bottom:1px solid #eef2f7}
  .entry:last-child{border-bottom:0}
  .entry .et{font-weight:600; font-size:.95rem}
  .entry .em{font-size:.86rem; color:var(--muted); margin-top:2px}
  .entry time{font-size:.75rem; color:var(--silver)}
  .empty{color:var(--muted); font-style:italic}
  footer{margin-top:34px; font-size:.78rem; color:var(--muted); text-align:center}
  footer a{color:var(--steel)}
  .toast{position:fixed; bottom:18px; left:50%; transform:translateX(-50%);
    background:var(--ink); color:#fff; padding:9px 15px; border-radius:8px; font-size:.85rem;
    opacity:0; transition:opacity .2s; pointer-events:none}
  .toast.show{opacity:1}
</style>
</head>
<body>
<main>
  <header>
    <h1>Pogoda Chrzanów <span>· Kościelec</span></h1>
    <p>Mediana wielu źródeł · jakość powietrza i pyłki · ostrzeżenia IMGW · feed zmian</p>
  </header>

  <div class="btns">
    <a class="btn primary" href="/feed.atom">＋ Subskrybuj (Atom)</a>
    <a class="btn ghost" href="/warnings.atom">⚠ Tylko ostrzeżenia</a>
    <button class="btn ghost" id="copy">Kopiuj URL feedu</button>
  </div>

  <div class="card" id="nowCard" aria-live="polite">
    <div class="now">
      <span class="temp" id="temp">${now.temp}</span>
      <span>
        <span class="cond" id="cond">${now.condition}</span><br>
        <span class="spread" id="spread">${now.spread}</span>
      </span>
    </div>
    <div class="metrics" id="metrics">${now.metrics}</div>
    <div class="src" id="src">${now.source}</div>
  </div>

  <h2>Powietrze i pyłki</h2>
  <div class="card" id="airCard">${renderAir(state?.airQuality)}</div>

  <h2>Aktywne ostrzeżenia</h2>
  <div id="warnings">${renderWarnings(state?.warnings)}</div>

  <h2>Ostatnie zmiany</h2>
  <div class="card" id="entries">${renderEntries(entries)}</div>

  <footer>
    Źródła: Open-Meteo · OpenWeather · Visual Crossing · IMGW-PIB · Open-Meteo Air Quality (CAMS).
    Aktualizacja co 2 h (pogoda) i raz dziennie (prognoza).<br>
    <a href="https://trfny.com/">TRAVNY ↗</a>
  </footer>
</main>
<div class="toast" id="toast"></div>

<script>
(function(){
  var PL = {clear:"bezchmurnie",clouds:"zachmurzenie",fog:"mgła",drizzle:"mżawka",
    rain:"deszcz",snow:"śnieg",storm:"burza",unknown:"—"};
  var SRC = {openmeteo:"Open-Meteo",openweather:"OpenWeather",visualcrossing:"Visual Crossing"};

  function fmt(x){ return (x===null||x===undefined) ? "—" : (Math.round(x*10)/10); }
  function el(id){ return document.getElementById(id); }
  function esc(s){ var d=document.createElement("div"); d.textContent=s==null?"":String(s); return d.innerHTML; }

  function toast(msg){
    var t=el("toast"); t.textContent=msg; t.classList.add("show");
    setTimeout(function(){ t.classList.remove("show"); },1600);
  }

  el("copy").addEventListener("click", function(){
    var url=location.origin+"/feed.atom";
    if(navigator.clipboard){ navigator.clipboard.writeText(url).then(function(){toast("Skopiowano: "+url);}); }
    else { toast(url); }
  });

  function renderNow(s){
    if(!s || !s.ensemble){ el("cond").textContent="brak danych — czekam na pierwszy cykl"; el("temp").textContent="—"; return; }
    var e=s.ensemble;
    el("temp").textContent = fmt(e.tempC.median)+"°";
    el("cond").textContent = PL[e.condition] || e.condition;
    if(e.tempC.n>1){ el("spread").textContent = "rozrzut "+fmt(e.tempC.min)+"–"+fmt(e.tempC.max)+"° · "+e.tempC.n+" źródła"; }
    else { el("spread").textContent = "1 źródło"; }
    el("metrics").innerHTML =
      "<span>wiatr <b>"+fmt(e.windMs.median)+"</b> m/s</span>"+
      "<span>wilgotność <b>"+fmt(e.humidity.median)+"</b>%</span>"+
      "<span>ciśnienie <b>"+fmt(e.pressureHpa.median)+"</b> hPa</span>"+
      (e.uv && e.uv.median!=null ? "<span>UV <b>"+fmt(e.uv.median)+"</b></span>" : "");
    var names=(e.sources||[]).map(function(x){return SRC[x]||x;}).join(", ");
    var when = e.observedAt ? new Date(e.observedAt).toLocaleString("pl-PL") : "";
    el("src").textContent = (names?("Źródła: "+names):"")+(when?(" · "+when):"");
    if(s.imgwStation && s.imgwStation.tempC!=null){
      el("src").textContent += " · stacja IMGW (ref.): "+fmt(s.imgwStation.tempC)+"°";
    }
  }

  function renderWarnings(list){
    var wrap=el("warnings");
    if(!list || !list.length){ wrap.innerHTML='<p class="empty">Brak aktywnych ostrzeżeń.</p>'; return; }
    wrap.innerHTML = list.map(function(w){
      var cls = w.category==="hydro" ? "hydro" : (w.level && w.level>=3 ? "alarm" : "");
      var lvl = (w.level && w.level>=1) ? (" (stopień "+w.level+")") : "";
      var tag = w.category==="hydro" ? "IMGW hydro" : "IMGW";
      var range = (w.from||"?")+" → "+(w.to||"?");
      return '<div class="warn '+cls+'"><div class="wt">'+esc(tag+": "+w.event+lvl)+'</div>'+
        '<div class="wm">'+esc(w.content||"")+'<br>'+esc(range)+'</div></div>';
    }).join("");
  }

  function renderAir(aq){
    var wrap=el("airCard");
    if(!aq){ wrap.innerHTML='<p class="empty">Brak danych o jakości powietrza.</p>'; return; }
    var bands=[[20,"bardzo dobra","#10b981"],[40,"dobra","#84cc16"],[60,"umiarkowana","#f59e0b"],[80,"zła","#f97316"],[100,"bardzo zła","#ef4444"],[1e9,"ekstremalnie zła","#7f1d1d"]];
    var aqi=aq.europeanAqi, label="—", color="var(--muted)";
    if(aqi!=null){ for(var i=0;i<bands.length;i++){ if(aqi<=bands[i][0]){ label=bands[i][1]; color=bands[i][2]; break; } } }
    var html='<div class="now"><span class="temp" style="color:'+color+'">'+(aqi!=null?Math.round(aqi):"—")+'</span>'+
      '<span><span class="cond" style="color:'+color+'">AQI — '+esc(label)+'</span><br>'+
      '<span class="spread">PM2.5 '+fmt(aq.pm25)+' · PM10 '+fmt(aq.pm10)+' µg/m³</span></span></div>';
    var P={alder:"olcha",birch:"brzoza",grass:"trawy",mugwort:"bylica",ragweed:"ambrozja"};
    if(aq.pollen && aq.pollen.length){
      html+='<div class="metrics">'+aq.pollen.map(function(p){
        return "<span>"+esc(P[p.species]||p.species)+" <b>"+p.grains+"</b> ziaren/m³</span>";
      }).join("")+'</div>';
      html+='<div class="src">Pyłki orientacyjnie (CAMS, ziarna/m³); europejski indeks AQI.</div>';
    } else {
      html+='<div class="src">Brak istotnych pyłków; europejski indeks AQI.</div>';
    }
    wrap.innerHTML=html;
  }

  function renderEntries(xmlText){
    var wrap=el("entries");
    try{
      var doc=new DOMParser().parseFromString(xmlText,"application/xml");
      var entries=Array.prototype.slice.call(doc.getElementsByTagName("entry")).slice(0,8);
      if(!entries.length){ wrap.innerHTML='<p class="empty">Brak wpisów — czekam na pierwszą zmianę.</p>'; return; }
      wrap.innerHTML = entries.map(function(en){
        function t(tag){ var n=en.getElementsByTagName(tag)[0]; return n?n.textContent:""; }
        var when=t("published"); var d=when?new Date(when).toLocaleString("pl-PL"):"";
        return '<div class="entry"><div class="et">'+esc(t("title"))+'</div>'+
          '<div class="em">'+esc(t("content"))+'</div><time>'+esc(d)+'</time></div>';
      }).join("");
    }catch(_){ wrap.innerHTML='<p class="empty">Nie udało się wczytać feedu.</p>'; }
  }

  fetch("/state.json",{cache:"no-store"}).then(function(r){return r.json();}).then(function(s){
    renderNow(s); renderWarnings(s && s.warnings); renderAir(s && s.airQuality);
  }).catch(function(){ el("cond").textContent="nie udało się odświeżyć danych"; });

  fetch("/feed.atom",{cache:"no-store"}).then(function(r){return r.text();}).then(renderEntries)
    .catch(function(){ /* SSR content stays visible when refresh fails. */ });
})();
</script>
</body>
</html>`;
}
