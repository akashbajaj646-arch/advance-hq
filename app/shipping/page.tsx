import { redirect } from 'next/navigation';

export default function ShippingIndexPage() {
  redirect('/shipping/queue');
}
