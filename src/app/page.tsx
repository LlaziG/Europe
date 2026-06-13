import { getTimelinePayload } from "@/lib/data";
import TimelineApp from "@/components/timeline/TimelineApp";

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await getTimelinePayload();
  return <TimelineApp data={data} />;
}
