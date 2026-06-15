/**
 * Helper utilities for TREE Warehouse Logistics
 */

// Clean raw barcodes (remove quotes, brackets, leading dash, and prefix 'TR')
export function cleanBarcode(rawBarcode: string | number | null | undefined): string {
  if (rawBarcode === null || rawBarcode === undefined) return '';
  let cleaned = rawBarcode.toString().replace(/['"]/g, '').replace(/^-/, '').trim();
  if (cleaned.toUpperCase().startsWith('TR')) {
    cleaned = cleaned.substring(2);
  }
  return cleaned.replace(/^-/, '').trim();
}

// Normalize location IDs (Arabized string unifications for Taa Marbouta, Alif, and Yaa)
export function normalizeLocationId(locId: string | null | undefined): string {
  if (!locId) return '';
  return locId.toString()
    .trim()
    .replace(/\s+/g, ' ')                        // Merge multiple spaces
    .replace(/ة\b/g, 'ه')                         // Taa Marbouta -> Haa
    .replace(/[أإآ]/g, 'ا')                       // Unify Alifs
    .replace(/ى\b/g, 'ي');                        // Lene Alif -> Yaa
}

// Extract base numeric barcode (EAN-13 format matching)
export function extractBaseBarcode(sku: string | number | null | undefined): string {
  if (!sku) return '';
  const match = sku.toString().match(/\d{10,14}/);
  return match ? match[0] : sku.toString();
}

// High-performance token match for scrambled barcodes
export function getTokenKey(cleanedBarcode: string): string {
  return cleanedBarcode
    .toLowerCase()
    .split(/[^a-z0-9]/)
    .filter(t => t.length > 0)
    .sort()
    .join('|');
}

// Classify clothing product into custom zones
export function getProductCategory(productName: string | null | undefined): "A" | "B" | "C" | "D" | "E" {
  if (!productName) return "E";
  const name = productName.toLowerCase()
    .replace(/\s+/g, '')
    .replace(/ة\b/g, 'ه')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى\b/g, 'ي');
  
  // Custom keywords mapping
  const topsKeywords = ['تيشرت', 'قميص', 'هودي', 'سويت', 'جاكيت', 'بلوفر', 'بلوزه', 'كارديجان', 'تونيك', 'vest', 'jacket', 'shirt', 'hoodie', 'sweat'];
  const bottomsKeywords = ['بنطلون', 'شورت', 'جينز', 'تنوره', 'جيب', 'ليجن', 'pants', 'jeans', 'shorts', 'skirt'];
  const underwearKeywords = ['داخلي', 'بيجامه', 'ترينج', 'شراب', 'جوارب', 'بوكسر', 'فانله', 'كيلوت', 'socks', 'underwear', 'pajama', 'boxer'];
  const accessoriesKeywords = ['شوز', 'حذاء', 'سنيكر', 'شنطه', 'حقيبه', 'حزام', 'كاب', 'نظاره', 'محفظه', 'shoes', 'bag', 'belt', 'cap', 'wallet'];

  if (topsKeywords.some(kw => name.includes(kw))) return "A";
  if (bottomsKeywords.some(kw => name.includes(kw))) return "B";
  if (underwearKeywords.some(kw => name.includes(kw))) return "C";
  if (accessoriesKeywords.some(kw => name.includes(kw))) return "D";
  
  return "E";
}

// Readable category names generator
export function getCategoryName(cat: "A" | "B" | "C" | "D" | "E"): string {
  switch(cat) {
    case 'A': return 'القطع العلوية (Tops)';
    case 'B': return 'القطع السفلية (Bottoms)';
    case 'C': return 'الملابس الداخلية والمنزلية';
    case 'D': return 'الأحذية والإكسسوارات';
    default: return 'أصناف متنوعة (Misc)';
  }
}
