import { PageHeader } from "../components/PageHeader";
import { DNSLookupForm } from "../components/DNSLookupForm";
import { DNSQueryTestForm } from "../components/DNSQueryTestForm";

export function Tools() {
  return (
    <>
      <PageHeader title="Tools" description="DNS utilities and diagnostics" />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <DNSLookupForm />
        <DNSQueryTestForm />
      </main>
    </>
  );
}
