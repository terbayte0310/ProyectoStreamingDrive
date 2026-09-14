import CatalogPage from "@/app/catalog/page";

export const dynamic = "force-dynamic";

export default function CoursesCatalogPage({ searchParams }: { searchParams: Promise<{ access?: string }> }) {
  return <CatalogPage forceCourses searchParams={searchParams} />;
}
