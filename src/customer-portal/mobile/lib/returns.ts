export type ReturnMethod = 'pickup' | 'dropoff';

export type ReturnContactInfo = {
  name: string;
  phone: string;
  address: string;
  city: string;
  state: string;
};

export type ReturnLocationState = {
  customer?: ReturnContactInfo;
  hub?: ReturnContactInfo;
  method?: ReturnMethod;
};

export type ReturnConfirmationState = {
  return_code?: string;
  fez_tracking?: string | null;
  method?: ReturnMethod;
  customer?: Partial<ReturnContactInfo>;
  hub?: Partial<ReturnContactInfo>;
};

export const defaultReturnContact: ReturnContactInfo = {
  name: '',
  phone: '',
  address: '',
  city: '',
  state: '',
};

export const fallbackReturnHub: ReturnContactInfo = {
  name: 'Warri Hub',
  phone: '',
  address: '',
  city: 'Warri',
  state: 'Delta',
};

export function returnMethodPath(base: string, id: string): string {
  return `${base}/return/${id}/method`.replace('//', '/');
}

export function returnConfirmationPath(base: string, id: string): string {
  return `${base}/return/${id}/confirmation`.replace('//', '/');
}

export function returnConfirmationStorageKey(id: string): string {
  return `return-confirmation-${id}`;
}

export function loadReturnConfirmation(id: string): ReturnConfirmationState | null {
  const stored = sessionStorage.getItem(returnConfirmationStorageKey(id));
  if (!stored) return null;
  try {
    return JSON.parse(stored) as ReturnConfirmationState;
  } catch {
    return null;
  }
}

export function saveReturnConfirmation(id: string, payload: ReturnConfirmationState): void {
  sessionStorage.setItem(returnConfirmationStorageKey(id), JSON.stringify(payload));
}

export async function createReturnShipment(input: {
  returnRequestId: string;
  method: ReturnMethod;
  customer: ReturnContactInfo;
  hub: ReturnContactInfo;
}): Promise<{ return_code: string; fez_tracking?: string | null }> {
  const apiBase = import.meta.env.VITE_API_BASE_URL || '';
  const response = await fetch(`${apiBase}/api/create-return-shipment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      return_request_id: input.returnRequestId,
      method: input.method,
      customer: input.customer,
      hub: input.hub,
    }),
  });

  const data = await response.json();
  if (!response.ok || !data?.success) {
    throw new Error(data?.error || 'Unable to start return shipment');
  }

  return {
    return_code: data.return_code,
    fez_tracking: data.fez_tracking || null,
  };
}
