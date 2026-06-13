import { getTimelinePayload } from "@/lib/data";
import TimelineApp from "@/components/timeline/TimelineApp";

export const dynamic = "force-dynamic";

export default async function CivCardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await getTimelinePayload();
  return (
    <TimelineApp
      data={data}
      initialView={{ kind: "card", type: "civilization", slug }}
    />
  );
}
