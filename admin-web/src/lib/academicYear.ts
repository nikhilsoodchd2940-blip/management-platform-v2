/** The academic year runs from September: in October 2026 it is "2026 – 2027". */
export const currentAcademicStart = () => {
  const d = new Date();
  return d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
};
export const academicYearLabel = (start: number | string) => `${Number(start)} – ${Number(start) + 1}`;
export const academicYearOptions = () => {
  const y = currentAcademicStart();
  return [y + 1, y, y - 1, y - 2].map((s) => ({ value: String(s), label: academicYearLabel(s) }));
};
