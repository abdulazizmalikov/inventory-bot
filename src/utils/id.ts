import { v4 as uuidv4 } from 'uuid';

export function generateId(): string {
  return uuidv4();
}

export function generatePOId(): string {
  return `PO-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function generateMoveId(): string {
  return `MOVE-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function generateWriteOffId(): string {
  return `WO-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

