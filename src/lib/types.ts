export type Role="teacher"|"student"; export type ExamStatus="draft"|"published"|"closed"|"archived"; export type SectionType="module"|"break"; export type Option="A"|"B"|"C"|"D";
export interface Profile { id:string;full_name:string;email:string;role:Role }
export interface ExamSummary { id:string;title:string;description:string|null;access_code_required:boolean;status:ExamStatus;scheduled_start_at:string;scheduled_end_at:string;published_at:string|null;created_at:string }
export interface ExamSection { id:string;exam_id:string;title:string;section_type:SectionType;section_order:number;duration_seconds:number;question_count?:number }
export interface StudentQuestion { id:string;section_id:string;question_order:number;image_path:string|null;image_url?:string|null;optional_text:string|null;option_a:string;option_b:string;option_c:string;option_d:string }
export interface SavedAnswer { question_id:string;selected_option:Option|null;marked_for_review:boolean;client_revision?:number;updated_at?:string }
export interface SectionAttempt { id:string;exam_attempt_id:string;section_id:string;started_at:string;expires_at:string;submitted_at:string|null;status:"in_progress"|"submitted"|"expired" }
