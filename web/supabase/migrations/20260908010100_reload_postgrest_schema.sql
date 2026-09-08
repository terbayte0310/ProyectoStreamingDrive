-- Refresh Supabase's API schema cache after adding course_sections.is_detected_section.

notify pgrst, 'reload schema';
