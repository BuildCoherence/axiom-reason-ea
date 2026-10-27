// One shared UTF-8 byte-length helper for the lean-ui surfaces.
//
// Lean source byte offsets / ranges (ShikiSlice, the /highlight-slice route,
// author_byte_range) are UTF-8 BYTE positions, so widths must be measured with
// TextEncoder, not `string.length` (which counts UTF-16 code units and diverges
// on any non-ASCII glyph). One module-level encoder is reused across calls.
const encoder = new TextEncoder();

export function byteLen(s: string): number {
  return encoder.encode(s).length;
}
