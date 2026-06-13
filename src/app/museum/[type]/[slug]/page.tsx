import { notFound } from "next/navigation";
import { getMuseum } from "@/lib/museum-data";
import MuseumGallery from "@/components/museum/MuseumGallery";

export const dynamic = "force-dynamic";

export default async function MuseumPage({
  params,
}: {
  params: Promise<{ type: string; slug: string }>;
}) {
  const { type, slug } = await params;
  if (type !== "civilization" && type !== "event") notFound();
  const data = await getMuseum(type, slug);
  if (!data) notFound();
  return (
    <MuseumGallery
      entity={data.entity}
      artworks={data.artworks}
      chapters={data.chapters}
    />
  );
}
