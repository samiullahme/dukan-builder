export type CategoryKey = "restaurant" | "salon" | "clinic" | "retail" | "real-estate" | "other";

export type Palette = { primary: string; accent: string; bg: string };

type CategoryDef = {
  key: CategoryKey;
  label: string;
  request: string;
  cta: string;
  mediaQueries: string[];
  /** Curated fallback used only when Pixabay is unavailable. */
  fallback: string[];
  palette: Palette;
};

export const CATEGORIES: CategoryDef[] = [
  {
    key: "restaurant",
    label: "Restaurant / Café / Food",
    request: "Table booking",
    cta: "Book a table",
    mediaQueries: ["restaurant interior", "grilled food platter", "chef cooking kitchen", "table setting restaurant", "street food market"],
    fallback: [
      "1555939594-58d7cb561ad1",
      "1517248135467-4c7edcad34c4",
      "1414235077428-338989a2e8c0",
      "1544025162-d76694265947",
      "1552566626-52f8b828add9",
      "1504674900247-0877df9cc836",
    ],
    palette: { primary: "#6f1d1b", accent: "#c9973f", bg: "#f8f1e4" },
  },
  {
    key: "salon",
    label: "Salon / Barber / Beauty",
    request: "Appointment request",
    cta: "Book an appointment",
    mediaQueries: ["hair salon interior", "hairstylist working", "barber shop", "beauty treatment", "salon mirror chair"],
    fallback: [
      "1560066984-138dadb4c035",
      "1522337660859-02fbefca4702",
      "1562322140-8baeececf3df",
      "1595476108010-b4d1f102b1b1",
      "1503951914875-452162b0f3f1",
      "1521590832167-7bcbfaa6381f",
    ],
    palette: { primary: "#2b2430", accent: "#c08b72", bg: "#faf4f0" },
  },
  {
    key: "clinic",
    label: "Clinic / Doctor / Dental",
    request: "Appointment request",
    cta: "Request an appointment",
    mediaQueries: ["dental clinic", "doctor consultation", "medical office interior", "dentist tools", "reception clinic"],
    fallback: [
      "1576091160399-112ba8d25d1d",
      "1629909613654-28e377c37b09",
      "1579684385127-1efb6c68f067",
      "1622253692010-333f2da6031d",
      "1584982751601-97dcc096659c",
      "1519494026892-80bbd2d6fd0d",
    ],
    palette: { primary: "#0e5b5b", accent: "#8fc4bd", bg: "#f4faf9" },
  },
  {
    key: "retail",
    label: "Shop / Retail / Boutique",
    request: "Order request",
    cta: "Order on WhatsApp",
    mediaQueries: ["clothing boutique interior", "fashion shop display", "store shelves products", "retail counter", "handmade products"],
    fallback: [
      "1441986300917-64674bd600d8",
      "1557804506-669a67965ba0",
      "1567401893414-76b7b1e5a7a5",
      "1523381210434-271e8be1f52b",
      "1472851294608-062f824d29cc",
      "1445205170230-053b83016050",
    ],
    palette: { primary: "#3a2a1a", accent: "#c9a227", bg: "#f7f2e9" },
  },
  {
    key: "real-estate",
    label: "Real estate / Property",
    request: "Viewing request",
    cta: "Request a viewing",
    mediaQueries: ["modern house exterior", "living room interior", "apartment kitchen", "property for sale", "house garden"],
    fallback: [
      "1564013799919-ab600027ffc6",
      "1600585154340-be6161a56a0c",
      "1512917774080-9991f1c4c750",
      "1600607687939-ce8a6c25118c",
      "1502672260266-1c1ef2d93688",
      "1600566753190-17f0baa2a6c3",
    ],
    palette: { primary: "#1c2c3a", accent: "#bfa06a", bg: "#f4f5f3" },
  },
  {
    key: "other",
    label: "Other local business",
    request: "Inquiry",
    cta: "Get in touch",
    mediaQueries: ["small business workshop", "office interior", "team working", "local shop counter", "handcraft workshop"],
    fallback: [
      "1441986300917-64674bd600d8",
      "1557804506-669a67965ba0",
      "1497366754035-f200968a6e72",
      "1522071820081-009f0129c71c",
      "1521737711867-e3b97375f902",
      "1486406146926-c627a92ad1ab",
    ],
    palette: { primary: "#0b3d2e", accent: "#e0aa33", bg: "#faf7f1" },
  },
];

export function normalizeCategory(value: unknown): CategoryKey {
  const v = String(value ?? "").trim().toLowerCase();
  return (CATEGORIES.find((c) => c.key === v)?.key ?? "other") as CategoryKey;
}

export function getCategory(value: unknown): CategoryDef {
  return CATEGORIES.find((c) => c.key === normalizeCategory(value)) ?? CATEGORIES[CATEGORIES.length - 1];
}

export const CATEGORY_COLORS: Record<string, Palette> = {
  "Deep green & gold (classic)": { primary: "#0b3d2e", accent: "#e0aa33", bg: "#faf7f1" },
  "Navy & white (clean)": { primary: "#1e3a5f", accent: "#4f9cf0", bg: "#f7fafd" },
  "Maroon & cream (traditional)": { primary: "#6b1f2a", accent: "#d9a441", bg: "#faf5ec" },
  "Charcoal & lime (modern)": { primary: "#22252a", accent: "#b8d62e", bg: "#f6f7f4" },
  "Teal & sand (fresh)": { primary: "#0f6a6a", accent: "#e8b04b", bg: "#f7f4ec" },
};
