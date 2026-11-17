const ICON_SIZE = 64
const MASK_BYTES = ICON_SIZE * ICON_SIZE

const iconMaskCache = new Map<string, Promise<string | null>>()

function isSvgUrl(url: string): boolean {
  return url.startsWith("data:image/svg+xml") || url.endsWith(".svg")
}

/** Forces the root <svg> tag to 64x64, replacing any existing width/height. */
function forceSvgSize(svgText: string): string {
  return svgText.replace(/<svg\b[^>]*>/i, (tag) => {
    const withoutSize = tag.replace(/\s(?:width|height)=("[^"]*"|'[^']*')/gi, "")
    return withoutSize.replace(/^<svg/i, `<svg width="${ICON_SIZE}" height="${ICON_SIZE}"`)
  })
}

async function toImageSource(url: string): Promise<string> {
  if (!isSvgUrl(url)) return url
  const text = await (await fetch(url)).text()
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(forceSvgSize(text))}`
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function rasterizeAlphaMask(src: string): Promise<string> {
  const img = new Image()
  img.src = src
  await img.decode()

  const canvas = document.createElement("canvas")
  canvas.width = ICON_SIZE
  canvas.height = ICON_SIZE
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("2d canvas context unavailable")
  ctx.drawImage(img, 0, 0, ICON_SIZE, ICON_SIZE)

  const { data } = ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE)
  const alpha = new Uint8Array(MASK_BYTES)
  for (let i = 0; i < MASK_BYTES; i += 1) alpha[i] = data[i * 4 + 3]
  return bytesToBase64(alpha)
}

/**
 * Base64 of the 64x64 alpha channel (row-major, 4096 bytes) of a provider icon.
 * Cached per url. Resolves null (and logs) when the icon cannot be rasterized.
 */
export function getIconMask(url: string): Promise<string | null> {
  const cached = iconMaskCache.get(url)
  if (cached) return cached

  const pending = (async () => {
    try {
      return await rasterizeAlphaMask(await toImageSource(url))
    } catch (error) {
      console.error("icon mask failed", url, error)
      return null
    }
  })()
  iconMaskCache.set(url, pending)
  return pending
}
