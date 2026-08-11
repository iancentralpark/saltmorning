import { CurriculumMindmap } from "@/components/mindmap/CurriculumMindmap";

type Props = {
  searchParams: Promise<{ framework?: string; org?: string }>;
};

export default async function MapPage({ searchParams }: Props) {
  const sp = await searchParams;
  return (
    <CurriculumMindmap
      initialFramework={sp.framework}
      initialOrg={sp.org}
    />
  );
}
