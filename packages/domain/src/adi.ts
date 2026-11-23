import {roundMoney, type QuoteLine} from './alarm-ops';

/**
 * Parts quoting against ADI Global Distribution.
 * Demo and tests use the mock catalog. ADI's published PriceAndInventory call
 * returns a dealer price for an item number. It does not return a photo,
 * a description, or quantities by branch, so those stay on the catalog record.
 */

export type AdiBranchStock = {branch: string; quantity: number};

export type AdiPart = {
  partNumber: string;
  description: string;
  dealerPrice: number;
  stock: AdiBranchStock[];
  imageUrl: string;
};

export interface AdiPartsSource {
  search(query: string): Promise<AdiPart[]>;
}

export class AdiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdiError';
  }
}

const PARTS: readonly AdiPart[] = [
  part('2W-B', 'System Sensor photoelectric smoke detector, 2-wire', 18.4, [['Boise', 42], ['Meridian', 11], ['Nampa', 0]]),
  part('P2RL', 'System Sensor horn/strobe, wall, red', 27.15, [['Boise', 18], ['Meridian', 6], ['Nampa', 2]]),
  part('SK-PHOTO-W', 'Silent Knight addressable photo detector, white', 32.8, [['Boise', 9], ['Meridian', 0], ['Nampa', 4]]),
  part('5816', 'Resideo wireless door and window contact', 14.8, [['Boise', 60], ['Meridian', 22], ['Nampa', 15]]),
  part('PROA7PLUS', 'Resideo ProSeries 7 inch panel', 189, [['Boise', 3], ['Meridian', 1], ['Nampa', 0]]),
  part('PG9303', 'DSC PowerG door and window contact', 22.5, [['Boise', 27], ['Meridian', 8], ['Nampa', 5]]),
];

export function createMockAdiParts(): AdiPartsSource {
  return {
    async search(query: string) {
      const needle = query.trim().toLowerCase();
      if (needle.length < 2) return [];
      return PARTS.filter(item => `${item.partNumber} ${item.description}`.toLowerCase().includes(needle)).map(item => ({...item, stock: item.stock.map(row => ({...row}))}));
    },
  };
}

export function markedUpUnitPrice(dealerPrice: number, markupPercent: number) {
  if (!Number.isFinite(dealerPrice) || dealerPrice < 0) throw new AdiError('Dealer price cannot be negative.');
  if (!Number.isFinite(markupPercent) || markupPercent < 0 || markupPercent > 300) throw new AdiError('Markup must be from 0 to 300 percent.');
  return roundMoney(dealerPrice * (1 + markupPercent / 100));
}

export function adiQuoteLine(item: AdiPart, quantity: number, markupPercent: number, id: string): QuoteLine {
  if (!(quantity > 0)) throw new AdiError('Quantity must be greater than 0.');
  return {id, description: `${item.partNumber} · ${item.description}`, kind: 'device', quantity, unitPrice: markedUpUnitPrice(item.dealerPrice, markupPercent)};
}

/** Overlay dealer prices from a PriceAndInventory payload. Branch stock and images stay on the catalog part. */
export function applyAdiPrices(parts: readonly AdiPart[], payload: unknown): AdiPart[] {
  const prices = priceRows(payload);
  return parts.map(item => {
    const match = prices.find(row => row.itemNumber.toLowerCase() === item.partNumber.toLowerCase());
    if (!match || match.allowedToBuy === 'N') return {...item, stock: item.stock.map(row => ({...row}))};
    return {...item, dealerPrice: match.price, stock: item.stock.map(row => ({...row}))};
  });
}

function part(partNumber: string, description: string, dealerPrice: number, stock: [string, number][]): AdiPart {
  return {
    partNumber,
    description,
    dealerPrice,
    stock: stock.map(([branch, quantity]) => ({branch, quantity})),
    imageUrl: partImage(partNumber),
  };
}

function partImage(label: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="8" fill="#f3eee6"/><text x="32" y="36" text-anchor="middle" font-family="sans-serif" font-size="9" fill="#1c1915">${label.slice(0, 8)}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function priceRows(payload: unknown) {
  const root = payload && typeof payload === 'object' ? payload as {ItemList?: unknown} : {};
  const list = Array.isArray(root.ItemList) ? root.ItemList : [];
  return list.flatMap(row => {
    if (!row || typeof row !== 'object') return [];
    const item = row as {ItemNumber?: unknown; ItemPrice?: unknown; AllowedToBuy?: unknown};
    const itemNumber = typeof item.ItemNumber === 'string' ? item.ItemNumber : '';
    const price = Number(item.ItemPrice);
    if (!itemNumber || !Number.isFinite(price)) return [];
    return [{itemNumber, price, allowedToBuy: typeof item.AllowedToBuy === 'string' ? item.AllowedToBuy : 'Y'}];
  });
}
