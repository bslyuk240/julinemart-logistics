export type ProductStatus = 'draft' | 'published';
export type ProductType = 'simple' | 'variable';
export type StockStatus = 'instock' | 'outofstock' | 'onbackorder';

export interface ImageRow {
  src: string;
  alt: string;
  position: number;
  is_thumbnail: boolean;
}

export interface ProductUploadForm {
  name: string;
  slug: string;
  short_description: string;
  description: string;
  status: ProductStatus;
  type: ProductType;
  regular_price: string;
  sale_price: string;
  sku: string;
  manage_stock: boolean;
  stock_quantity: string;
  stock_status: StockStatus;
  is_virtual: boolean;
  ships_from_abroad: boolean;
  vendor_id: string;
  hub_id: string;
  seo_title: string;
  seo_description: string;
  weight: string;
  length: string;
  width: string;
  height: string;
  category_ids: string[];
  tag_ids: string[];
  images: ImageRow[];
}

export const PRODUCT_UPLOAD_STEPS = [
  { id: 'basics', title: 'Basics', subtitle: 'Type, name & descriptions' },
  { id: 'vendor', title: 'Vendor', subtitle: 'Who fulfills & how it ships' },
  { id: 'catalog', title: 'Catalog', subtitle: 'Categories & tags' },
  { id: 'offer', title: 'Pricing', subtitle: 'Price, stock or variations' },
  { id: 'media', title: 'Photos', subtitle: 'Gallery images' },
  { id: 'review', title: 'Review', subtitle: 'SEO & save' },
] as const;

export const emptyProductUploadForm = (): ProductUploadForm => ({
  name: '',
  slug: '',
  short_description: '',
  description: '',
  status: 'draft',
  type: 'simple',
  regular_price: '',
  sale_price: '',
  sku: '',
  manage_stock: false,
  stock_quantity: '',
  stock_status: 'instock',
  is_virtual: false,
  ships_from_abroad: false,
  vendor_id: '',
  hub_id: '',
  seo_title: '',
  seo_description: '',
  weight: '',
  length: '',
  width: '',
  height: '',
  category_ids: [],
  tag_ids: [],
  images: [],
});
