
export interface Supplier {
  id: number;
  name: string;
  type: string;
  building: string;
  floor: string;
  locationDescription: string; // optional field for additional location details
  latitude: number; 
  longitude: number; 
  startingTime: string;
  closingTime: string;
  imageUrl?: string; 
}

export type CreateSupplierInput = Omit<Supplier, 'id'>;