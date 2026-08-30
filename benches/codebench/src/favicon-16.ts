const DATA = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA5UlEQVR42sWSPW7CUBCEv7XcEhpsTkB4rokRHQdAnAC5iFLTUecEXAFRIE4Q5QDpEh7UGDgBgYr03jSAQED4MVKmWmlmZ3e0KwB+LlNDnFcg5DJYQZvzxWog6+Y3boCgFfG97BcQjoZW4nEMgAkMpadQd8XHeIUPd7N2PI5pvzwD0Op0D6Yd4wWqDinhbgoTmK2zCcyB8BQvvpdN0myQOsL/G7h/3XlXOJtOpBFFAPR7PQqPRd0zOPcHjSjCFM22vluEi1/5RAQree+hrMjnTeM1qTvzxWogaAWwV7RaNKl/L3/efwGNI2NdSoLvmAAAAABJRU5ErkJggg==";

export function favicon16Response(pathname: string): Response | null {
  if (pathname !== "/favicon-16x16.png") return null;

  const binary = atob(DATA);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Response(buffer, {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=604800, immutable",
    },
  });
}
