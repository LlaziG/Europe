import { getTimelinePayload } from "@/lib/data";
import TimelineApp from "@/components/timeline/TimelineApp";

export const dynamic = "force-dynamic";

export default async function EventTracePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ path?: string }>;
}) {
  const { slug } = await params;
  const { path } = await searchParams;
  const walked = (path ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const data = await getTimelinePayload();
  return (
    <TimelineApp
      data={data}
      initialView={{ kind: "trace", slug, path: [slug, ...walked.filter((s) => s !== slug)] }}
    />
  );
}
