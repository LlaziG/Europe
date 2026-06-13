import { notFound } from "next/navigation";
import { getMuseum } from "@/lib/museum-data";
import MuseumGallery from "@/components/museum/MuseumGallery";

export const dynamic = "force-dynamic";

export default async function EventMuseumPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await getMuseum("event", slug);
  if (!data) notFound();
  return (
    <MuseumGallery
      entity={data.entity}
      artworks={data.artworks}
      chapters={data.chapters}
    />
  );
}
