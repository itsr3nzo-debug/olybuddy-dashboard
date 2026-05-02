import type { Metadata } from "next";
import IcloudBridgePage from "@/components/integrations/icloud-bridge/IcloudBridgePage";

export const metadata: Metadata = { title: "iCloud Bridge | Nexley AI" };

export default function Page() {
  return <IcloudBridgePage />;
}
