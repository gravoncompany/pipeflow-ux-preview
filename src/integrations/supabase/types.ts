export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_knowledge: {
        Row: {
          author_id: string | null
          company_key: string
          created_at: string
          entry_type: string
          generation: number
          id: string
          kind: string
          origin: string
          revision: number
          sources: number
          text: string
          title: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          company_key?: string
          created_at?: string
          entry_type?: string
          generation: number
          id?: string
          kind: string
          origin?: string
          revision?: number
          sources?: number
          text: string
          title?: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          company_key?: string
          created_at?: string
          entry_type?: string
          generation?: number
          id?: string
          kind?: string
          origin?: string
          revision?: number
          sources?: number
          text?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_knowledge_operations: {
        Row: {
          author_id: string
          company_key: string
          created_at: string
          event_key: string
          id: string
          knowledge_id: string
          operation: string
          origin: string
          payload: Json
        }
        Insert: {
          author_id: string
          company_key: string
          created_at?: string
          event_key: string
          id?: string
          knowledge_id: string
          operation: string
          origin: string
          payload: Json
        }
        Update: {
          author_id?: string
          company_key?: string
          created_at?: string
          event_key?: string
          id?: string
          knowledge_id?: string
          operation?: string
          origin?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ai_knowledge_operations_knowledge_id_fkey"
            columns: ["knowledge_id"]
            isOneToOne: false
            referencedRelation: "ai_knowledge"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_learning_items: {
        Row: {
          chunk: number
          conversation_key: string
          id: number
          messages: Json
          result: Json | null
          run_id: string
        }
        Insert: {
          chunk: number
          conversation_key: string
          id?: never
          messages: Json
          result?: Json | null
          run_id: string
        }
        Update: {
          chunk?: number
          conversation_key?: string
          id?: never
          messages?: Json
          result?: Json | null
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_learning_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ai_learning_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_learning_runs: {
        Row: {
          conversation_count: number
          created_at: string
          error: string | null
          id: string
          insight_offset: number
          insights: Json
          lease_token: string | null
          lease_until: string | null
          message_count: number
          phase: string
          status: string
        }
        Insert: {
          conversation_count?: number
          created_at?: string
          error?: string | null
          id?: string
          insight_offset?: number
          insights?: Json
          lease_token?: string | null
          lease_until?: string | null
          message_count?: number
          phase?: string
          status?: string
        }
        Update: {
          conversation_count?: number
          created_at?: string
          error?: string | null
          id?: string
          insight_offset?: number
          insights?: Json
          lease_token?: string | null
          lease_until?: string | null
          message_count?: number
          phase?: string
          status?: string
        }
        Relationships: []
      }
      analysis_delivery_receipts: {
        Row: {
          instance: string
          message_id: string
          received_at: string
          remote_jid: string
          state: string
        }
        Insert: {
          instance: string
          message_id: string
          received_at?: string
          remote_jid: string
          state: string
        }
        Update: {
          instance?: string
          message_id?: string
          received_at?: string
          remote_jid?: string
          state?: string
        }
        Relationships: []
      }
      analysis_message_drafts: {
        Row: {
          accepted_at: string | null
          analysis_result: Json
          analyzed_at: string
          anchor_from_me: boolean
          anchor_id: string
          approved_at: string | null
          approved_by: string | null
          approved_text: string | null
          author_id: string
          company_key: string
          created_at: string
          db_snapshot: Json
          error: string | null
          id: string
          instance: string
          lead_snapshot: Json
          phone: string
          phone_key: string
          provider_id: string | null
          provider_snapshot: string
          recipient_name: string
          remote_jid: string
          scope_end: string
          scope_start: string
          status: string
          suggestion: string
          synced_at: string | null
        }
        Insert: {
          accepted_at?: string | null
          analysis_result: Json
          analyzed_at: string
          anchor_from_me: boolean
          anchor_id: string
          approved_at?: string | null
          approved_by?: string | null
          approved_text?: string | null
          author_id: string
          company_key: string
          created_at?: string
          db_snapshot: Json
          error?: string | null
          id?: string
          instance: string
          lead_snapshot: Json
          phone: string
          phone_key: string
          provider_id?: string | null
          provider_snapshot: string
          recipient_name: string
          remote_jid: string
          scope_end?: string
          scope_start?: string
          status?: string
          suggestion: string
          synced_at?: string | null
        }
        Update: {
          accepted_at?: string | null
          analysis_result?: Json
          analyzed_at?: string
          anchor_from_me?: boolean
          anchor_id?: string
          approved_at?: string | null
          approved_by?: string | null
          approved_text?: string | null
          author_id?: string
          company_key?: string
          created_at?: string
          db_snapshot?: Json
          error?: string | null
          id?: string
          instance?: string
          lead_snapshot?: Json
          phone?: string
          phone_key?: string
          provider_id?: string | null
          provider_snapshot?: string
          recipient_name?: string
          remote_jid?: string
          scope_end?: string
          scope_start?: string
          status?: string
          suggestion?: string
          synced_at?: string | null
        }
        Relationships: []
      }
      analysis_qualification_actions: {
        Row: {
          analysis_id: string
          analyzed_at: string
          created_at: string
          expected_revision: number
          fingerprint: string
          id: string
          internal_note: string
          lead_id: string
          pipeline_id: string | null
          resolved_at: string | null
          status: string
          tag_id: string
          tag_label: string
          target_stage: string
          target_title: string
        }
        Insert: {
          analysis_id: string
          analyzed_at: string
          created_at?: string
          expected_revision: number
          fingerprint: string
          id?: string
          internal_note?: string
          lead_id: string
          pipeline_id?: string | null
          resolved_at?: string | null
          status?: string
          tag_id: string
          tag_label: string
          target_stage: string
          target_title: string
        }
        Update: {
          analysis_id?: string
          analyzed_at?: string
          created_at?: string
          expected_revision?: number
          fingerprint?: string
          id?: string
          internal_note?: string
          lead_id?: string
          pipeline_id?: string | null
          resolved_at?: string | null
          status?: string
          tag_id?: string
          tag_label?: string
          target_stage?: string
          target_title?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_qualification_actions_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analysis_qualification_actions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      b2b_ai_email_batches: {
        Row: {
          bases: Json
          created_at: string
          error_message: string
          id: string
          lease_token: string | null
          lease_until: string | null
          request_key: string
          sender: string
          state: string
          template: string
        }
        Insert: {
          bases?: Json
          created_at?: string
          error_message?: string
          id?: string
          lease_token?: string | null
          lease_until?: string | null
          request_key: string
          sender: string
          state?: string
          template: string
        }
        Update: {
          bases?: Json
          created_at?: string
          error_message?: string
          id?: string
          lease_token?: string | null
          lease_until?: string | null
          request_key?: string
          sender?: string
          state?: string
          template?: string
        }
        Relationships: []
      }
      b2b_ai_email_control: {
        Row: {
          id: number
          message: string
          provider_denied: boolean
        }
        Insert: {
          id: number
          message?: string
          provider_denied?: boolean
        }
        Update: {
          id?: number
          message?: string
          provider_denied?: boolean
        }
        Relationships: []
      }
      b2b_ai_email_items: {
        Row: {
          batch_id: string
          body: string
          company: Json
          company_key: string
          context_status: string
          created_at: string
          error_message: string
          id: string
          operation_key: string
          personalization_fact: string
          personalization_source: string
          position: number
          provider_message_id: string | null
          recipient: string
          revision: number
          scheduled_for: string | null
          send_error: string
          send_lead_id: string | null
          send_reserved_at: string | null
          send_state: string
          sent_at: string | null
          state: string
          subject: string
          whatsapp_sent_at: string | null
          whatsapp_text: string
        }
        Insert: {
          batch_id: string
          body?: string
          company: Json
          company_key: string
          context_status?: string
          created_at?: string
          error_message?: string
          id?: string
          operation_key: string
          personalization_fact?: string
          personalization_source?: string
          position: number
          provider_message_id?: string | null
          recipient?: string
          revision?: number
          scheduled_for?: string | null
          send_error?: string
          send_lead_id?: string | null
          send_reserved_at?: string | null
          send_state?: string
          sent_at?: string | null
          state?: string
          subject?: string
          whatsapp_sent_at?: string | null
          whatsapp_text?: string
        }
        Update: {
          batch_id?: string
          body?: string
          company?: Json
          company_key?: string
          context_status?: string
          created_at?: string
          error_message?: string
          id?: string
          operation_key?: string
          personalization_fact?: string
          personalization_source?: string
          position?: number
          provider_message_id?: string | null
          recipient?: string
          revision?: number
          scheduled_for?: string | null
          send_error?: string
          send_lead_id?: string | null
          send_reserved_at?: string | null
          send_state?: string
          sent_at?: string | null
          state?: string
          subject?: string
          whatsapp_sent_at?: string | null
          whatsapp_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "b2b_ai_email_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "b2b_ai_email_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      b2b_ai_email_templates: {
        Row: {
          body: string
          key: string
          revision: number
          subject: string
        }
        Insert: {
          body: string
          key: string
          revision?: number
          subject: string
        }
        Update: {
          body?: string
          key?: string
          revision?: number
          subject?: string
        }
        Relationships: []
      }
      b2b_companies: {
        Row: {
          cnpj: string
          created_at: string
          id: string
          lead_id: string | null
          place_id: string
          profile: Json
        }
        Insert: {
          cnpj: string
          created_at?: string
          id?: string
          lead_id?: string | null
          place_id?: string
          profile: Json
        }
        Update: {
          cnpj?: string
          created_at?: string
          id?: string
          lead_id?: string | null
          place_id?: string
          profile?: Json
        }
        Relationships: [
          {
            foreignKeyName: "b2b_companies_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      b2b_company_insights: {
        Row: {
          analyzed_at: string | null
          error_code: string | null
          insight: Json | null
          lead_id: string
          lease_token: string | null
          lease_until: string | null
          sources: Json
          status: string
          updated_at: string
        }
        Insert: {
          analyzed_at?: string | null
          error_code?: string | null
          insight?: Json | null
          lead_id: string
          lease_token?: string | null
          lease_until?: string | null
          sources?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          analyzed_at?: string | null
          error_code?: string | null
          insight?: Json | null
          lead_id?: string
          lease_token?: string | null
          lease_until?: string | null
          sources?: Json
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      b2b_email_drafts: {
        Row: {
          body: string
          created_at: string
          id: string
          lead_id: string
          recipient: string
          state: string
          subject: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          lead_id: string
          recipient: string
          state: string
          subject: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          lead_id?: string
          recipient?: string
          state?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "b2b_email_drafts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      b2b_email_suppressions: {
        Row: {
          created_at: string
          email: string
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          reason?: string
        }
        Relationships: []
      }
      b2b_instagram_profiles: {
        Row: {
          address: string
          ai_commercial: boolean | null
          ai_location: string
          ai_relevance: string
          ai_segment: string
          ai_summary: string
          analyzed_at: string | null
          biography: string
          category: string
          city: string
          cnpj: string
          contact_sources: Json
          country: string
          created_at: string
          email: string
          enrichment: string
          external_url: string
          followers: number | null
          full_name: string
          hashtag: string
          id: string
          ig_user_id: string
          is_business: boolean | null
          phone: string
          post_url: string
          public_checked_at: string | null
          search_id: string
          state: string
          username: string
          whatsapp: string
        }
        Insert: {
          address?: string
          ai_commercial?: boolean | null
          ai_location?: string
          ai_relevance?: string
          ai_segment?: string
          ai_summary?: string
          analyzed_at?: string | null
          biography?: string
          category?: string
          city?: string
          cnpj?: string
          contact_sources?: Json
          country?: string
          created_at?: string
          email?: string
          enrichment?: string
          external_url?: string
          followers?: number | null
          full_name?: string
          hashtag?: string
          id?: string
          ig_user_id?: string
          is_business?: boolean | null
          phone?: string
          post_url?: string
          public_checked_at?: string | null
          search_id: string
          state?: string
          username: string
          whatsapp?: string
        }
        Update: {
          address?: string
          ai_commercial?: boolean | null
          ai_location?: string
          ai_relevance?: string
          ai_segment?: string
          ai_summary?: string
          analyzed_at?: string | null
          biography?: string
          category?: string
          city?: string
          cnpj?: string
          contact_sources?: Json
          country?: string
          created_at?: string
          email?: string
          enrichment?: string
          external_url?: string
          followers?: number | null
          full_name?: string
          hashtag?: string
          id?: string
          ig_user_id?: string
          is_business?: boolean | null
          phone?: string
          post_url?: string
          public_checked_at?: string | null
          search_id?: string
          state?: string
          username?: string
          whatsapp?: string
        }
        Relationships: [
          {
            foreignKeyName: "b2b_instagram_profiles_search_id_fkey"
            columns: ["search_id"]
            isOneToOne: false
            referencedRelation: "b2b_instagram_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      b2b_instagram_public_cache: {
        Row: {
          cache_key: string
          checked_at: string
          result: Json
          valid_until: string
        }
        Insert: {
          cache_key: string
          checked_at?: string
          result?: Json
          valid_until: string
        }
        Update: {
          cache_key?: string
          checked_at?: string
          result?: Json
          valid_until?: string
        }
        Relationships: []
      }
      b2b_instagram_searches: {
        Row: {
          created_at: string
          error: string | null
          finished_at: string | null
          hashtags: string[]
          id: string
          posts_found: number
          profiles_found: number
          results_limit: number
          runs: Json
          stage: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          finished_at?: string | null
          hashtags: string[]
          id?: string
          posts_found?: number
          profiles_found?: number
          results_limit: number
          runs?: Json
          stage?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          finished_at?: string | null
          hashtags?: string[]
          id?: string
          posts_found?: number
          profiles_found?: number
          results_limit?: number
          runs?: Json
          stage?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      b2b_lookup_cache: {
        Row: {
          checked_at: string
          desk_pending: boolean
          desk_query_code: string | null
          profile: Json | null
          provider: string
          query_key: string
          state: string
          valid_until: string
        }
        Insert: {
          checked_at?: string
          desk_pending?: boolean
          desk_query_code?: string | null
          profile?: Json | null
          provider: string
          query_key: string
          state: string
          valid_until: string
        }
        Update: {
          checked_at?: string
          desk_pending?: boolean
          desk_query_code?: string | null
          profile?: Json | null
          provider?: string
          query_key?: string
          state?: string
          valid_until?: string
        }
        Relationships: []
      }
      b2b_prep_queue: {
        Row: {
          attempts: number
          created_at: string
          error: string
          item_id: string | null
          lead_id: string
          lease_until: string | null
          state: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error?: string
          item_id?: string | null
          lead_id: string
          lease_until?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error?: string
          item_id?: string | null
          lead_id?: string
          lease_until?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "b2b_prep_queue_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      b2b_prep_runner: {
        Row: {
          ai_blocked_reason: string
          enabled: boolean
          id: boolean
          job_url: string
          last_result: Json
          last_run_at: string | null
          lease_token: string | null
          lease_until: string | null
          sender: string
          token: string
        }
        Insert: {
          ai_blocked_reason?: string
          enabled?: boolean
          id?: boolean
          job_url?: string
          last_result?: Json
          last_run_at?: string | null
          lease_token?: string | null
          lease_until?: string | null
          sender?: string
          token?: string
        }
        Update: {
          ai_blocked_reason?: string
          enabled?: boolean
          id?: boolean
          job_url?: string
          last_result?: Json
          last_run_at?: string | null
          lease_token?: string | null
          lease_until?: string | null
          sender?: string
          token?: string
        }
        Relationships: []
      }
      b2b_prospect_campaigns: {
        Row: {
          config: Json
          id: string
          revision: number
          status: string
          updated_at: string
        }
        Insert: {
          config: Json
          id?: string
          revision?: number
          status?: string
          updated_at?: string
        }
        Update: {
          config?: Json
          id?: string
          revision?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      b2b_public_enrichment_jobs: {
        Row: {
          applied: Json
          attempts: number
          finished_at: string | null
          lead_id: string
          lease_until: string | null
          origin: string
          outcome_code: string | null
          requested_at: string
          result: Json | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          applied?: Json
          attempts?: number
          finished_at?: string | null
          lead_id: string
          lease_until?: string | null
          origin: string
          outcome_code?: string | null
          requested_at?: string
          result?: Json | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          applied?: Json
          attempts?: number
          finished_at?: string | null
          lead_id?: string
          lease_until?: string | null
          origin?: string
          outcome_code?: string | null
          requested_at?: string
          result?: Json | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "b2b_public_enrichment_jobs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      b2b_requests: {
        Row: {
          created_at: string
          credit_balance: number | null
          id: string
          outcome: string
          provider: string
        }
        Insert: {
          created_at?: string
          credit_balance?: number | null
          id?: string
          outcome?: string
          provider: string
        }
        Update: {
          created_at?: string
          credit_balance?: number | null
          id?: string
          outcome?: string
          provider?: string
        }
        Relationships: []
      }
      commercial_goals: {
        Row: {
          action_plan: string
          company_key: string
          created_at: string
          data: Json
          id: string
          month: string
          notes: string
          pipeline_key: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          action_plan?: string
          company_key?: string
          created_at?: string
          data?: Json
          id?: string
          month: string
          notes?: string
          pipeline_key?: string
          updated_at?: string
          updated_by?: string
        }
        Update: {
          action_plan?: string
          company_key?: string
          created_at?: string
          data?: Json
          id?: string
          month?: string
          notes?: string
          pipeline_key?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: []
      }
      crm_agent_audit: {
        Row: {
          actor_id: string | null
          created_at: string
          detail: Json
          event: string
          id: string
          lead_id: string | null
          run_id: string | null
          settings_id: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          detail?: Json
          event: string
          id?: string
          lead_id?: string | null
          run_id?: string | null
          settings_id?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          detail?: Json
          event?: string
          id?: string
          lead_id?: string | null
          run_id?: string | null
          settings_id?: string | null
        }
        Relationships: []
      }
      crm_agent_contact_controls: {
        Row: {
          contact_key: string
          mode: string
          paused_until: string | null
          revision: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          contact_key: string
          mode?: string
          paused_until?: string | null
          revision?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          contact_key?: string
          mode?: string
          paused_until?: string | null
          revision?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      crm_agent_holds: {
        Row: {
          active: boolean
          contact_key: string
          reason: string
          released_by: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          contact_key: string
          reason: string
          released_by?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          contact_key?: string
          reason?: string
          released_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      crm_agent_runs: {
        Row: {
          accepted_at: string | null
          analysis: Json | null
          contact_key: string
          created_at: string
          decision_result: string | null
          from_stage: string | null
          id: string
          inbound_id: string
          instance: string
          lead_id: string | null
          lead_revision: number | null
          lease_until: string | null
          phone: string
          pipeline_id: string | null
          provider_id: string | null
          reason: string | null
          reply: string | null
          settings_id: string
          settings_revision: number
          status: string
          synced_at: string | null
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          analysis?: Json | null
          contact_key: string
          created_at?: string
          decision_result?: string | null
          from_stage?: string | null
          id?: string
          inbound_id: string
          instance: string
          lead_id?: string | null
          lead_revision?: number | null
          lease_until?: string | null
          phone: string
          pipeline_id?: string | null
          provider_id?: string | null
          reason?: string | null
          reply?: string | null
          settings_id: string
          settings_revision: number
          status?: string
          synced_at?: string | null
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          analysis?: Json | null
          contact_key?: string
          created_at?: string
          decision_result?: string | null
          from_stage?: string | null
          id?: string
          inbound_id?: string
          instance?: string
          lead_id?: string | null
          lead_revision?: number | null
          lease_until?: string | null
          phone?: string
          pipeline_id?: string | null
          provider_id?: string | null
          reason?: string | null
          reply?: string | null
          settings_id?: string
          settings_revision?: number
          status?: string
          synced_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_agent_runs_settings_id_fkey"
            columns: ["settings_id"]
            isOneToOne: false
            referencedRelation: "crm_agent_settings"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_agent_settings: {
        Row: {
          allowed_stages: string[]
          audience: string
          auto_move: boolean
          blocked_reason: string | null
          business_days: number[]
          created_at: string
          day_end: string
          day_start: string
          enabled: boolean
          excluded_regions: string[]
          handoff_keywords: string[]
          human_pause_hours: number
          id: string
          instance: string
          instructions: string
          max_message_age_minutes: number
          max_replies_per_contact_day: number
          max_replies_per_day: number
          max_reply_chars: number
          move_stages: string[] | null
          pause_on_human_reply: boolean
          pipeline_id: string | null
          qualification_requirements: string
          recipients: string[]
          revision: number
          sender_phone: string
          served_regions: string[]
          services: string[]
          stage_map: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allowed_stages?: string[]
          audience?: string
          auto_move?: boolean
          blocked_reason?: string | null
          business_days?: number[]
          created_at?: string
          day_end?: string
          day_start?: string
          enabled?: boolean
          excluded_regions?: string[]
          handoff_keywords?: string[]
          human_pause_hours?: number
          id?: string
          instance?: string
          instructions?: string
          max_message_age_minutes?: number
          max_replies_per_contact_day?: number
          max_replies_per_day?: number
          max_reply_chars?: number
          move_stages?: string[] | null
          pause_on_human_reply?: boolean
          pipeline_id?: string | null
          qualification_requirements?: string
          recipients?: string[]
          revision?: number
          sender_phone?: string
          served_regions?: string[]
          services?: string[]
          stage_map?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allowed_stages?: string[]
          audience?: string
          auto_move?: boolean
          blocked_reason?: string | null
          business_days?: number[]
          created_at?: string
          day_end?: string
          day_start?: string
          enabled?: boolean
          excluded_regions?: string[]
          handoff_keywords?: string[]
          human_pause_hours?: number
          id?: string
          instance?: string
          instructions?: string
          max_message_age_minutes?: number
          max_replies_per_contact_day?: number
          max_replies_per_day?: number
          max_reply_chars?: number
          move_stages?: string[] | null
          pause_on_human_reply?: boolean
          pipeline_id?: string | null
          qualification_requirements?: string
          recipients?: string[]
          revision?: number
          sender_phone?: string
          served_regions?: string[]
          services?: string[]
          stage_map?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_agent_settings_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "sales_pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_api_keys: {
        Row: {
          created_at: string
          id: string
          key_hash: string
          last_used_at: string | null
          name: string
          prefix: string
          revoked_at: string | null
          scope: string
          use_count: number
        }
        Insert: {
          created_at?: string
          id?: string
          key_hash: string
          last_used_at?: string | null
          name: string
          prefix: string
          revoked_at?: string | null
          scope?: string
          use_count?: number
        }
        Update: {
          created_at?: string
          id?: string
          key_hash?: string
          last_used_at?: string | null
          name?: string
          prefix?: string
          revoked_at?: string | null
          scope?: string
          use_count?: number
        }
        Relationships: []
      }
      crm_appointments: {
        Row: {
          cancelled_at: string | null
          created_at: string
          created_by: string
          ends_at: string
          event_id: string
          id: string
          lead_id: string
          origin: string
          responsible: string
          starts_at: string
          status: string
          summary: string
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          created_by?: string
          ends_at: string
          event_id: string
          id?: string
          lead_id: string
          origin: string
          responsible?: string
          starts_at: string
          status?: string
          summary: string
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          created_by?: string
          ends_at?: string
          event_id?: string
          id?: string
          lead_id?: string
          origin?: string
          responsible?: string
          starts_at?: string
          status?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_appointments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_automation_entries: {
        Row: {
          entered_at: string
          lead_id: string
          outcome: string
          pipeline_id: string
          processed_at: string | null
        }
        Insert: {
          entered_at?: string
          lead_id: string
          outcome?: string
          pipeline_id: string
          processed_at?: string | null
        }
        Update: {
          entered_at?: string
          lead_id?: string
          outcome?: string
          pipeline_id?: string
          processed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_automation_entries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_automation_events: {
        Row: {
          automation_id: string
          created_at: string
          detail: string
          id: string
          kind: string
          lead_id: string | null
          run_id: string | null
        }
        Insert: {
          automation_id: string
          created_at?: string
          detail?: string
          id?: string
          kind: string
          lead_id?: string | null
          run_id?: string | null
        }
        Update: {
          automation_id?: string
          created_at?: string
          detail?: string
          id?: string
          kind?: string
          lead_id?: string | null
          run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_automation_events_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "crm_automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automation_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "crm_automation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_automation_runs: {
        Row: {
          automation_id: string
          cancelled_at: string | null
          clicks: number
          contact: string
          created_at: string
          enrollment_id: string | null
          finished_at: string | null
          form_at: string | null
          form_lead_id: string | null
          id: string
          last_click_at: string | null
          lead_id: string
          reply_at: string | null
          source: string
          token: string
          updated_at: string
        }
        Insert: {
          automation_id: string
          cancelled_at?: string | null
          clicks?: number
          contact: string
          created_at?: string
          enrollment_id?: string | null
          finished_at?: string | null
          form_at?: string | null
          form_lead_id?: string | null
          id?: string
          last_click_at?: string | null
          lead_id: string
          reply_at?: string | null
          source: string
          token: string
          updated_at?: string
        }
        Update: {
          automation_id?: string
          cancelled_at?: string | null
          clicks?: number
          contact?: string
          created_at?: string
          enrollment_id?: string | null
          finished_at?: string | null
          form_at?: string | null
          form_lead_id?: string | null
          id?: string
          last_click_at?: string | null
          lead_id?: string
          reply_at?: string | null
          source?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_automation_runs_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "crm_automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automation_runs_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: true
            referencedRelation: "crm_email_flow_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automation_runs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_automations: {
        Row: {
          activated_at: string | null
          compile_ok: boolean
          compiled: Json
          created_at: string
          flow_id: string | null
          graph: Json
          id: string
          landing_url: string
          name: string
          revision: number
          slug: string
          state: string
          test_contacts: string[]
          trigger_mode: string
          trigger_pipeline_id: string | null
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          compile_ok?: boolean
          compiled?: Json
          created_at?: string
          flow_id?: string | null
          graph: Json
          id?: string
          landing_url?: string
          name: string
          revision?: number
          slug?: string
          state?: string
          test_contacts?: string[]
          trigger_mode?: string
          trigger_pipeline_id?: string | null
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          compile_ok?: boolean
          compiled?: Json
          created_at?: string
          flow_id?: string | null
          graph?: Json
          id?: string
          landing_url?: string
          name?: string
          revision?: number
          slug?: string
          state?: string
          test_contacts?: string[]
          trigger_mode?: string
          trigger_pipeline_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_automations_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "crm_email_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automations_trigger_pipeline_id_fkey"
            columns: ["trigger_pipeline_id"]
            isOneToOne: false
            referencedRelation: "sales_pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_calendar_blocked: {
        Row: {
          created_at: string
          created_by: string
          ends_at: string
          id: string
          reason: string
          starts_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          ends_at: string
          id?: string
          reason?: string
          starts_at: string
        }
        Update: {
          created_at?: string
          created_by?: string
          ends_at?: string
          id?: string
          reason?: string
          starts_at?: string
        }
        Relationships: []
      }
      crm_calendar_settings: {
        Row: {
          business_days: number[]
          calendar_id: string
          day_end: string
          day_start: string
          duration_minutes: number
          enabled: boolean
          gap_minutes: number
          id: number
          lunch_end: string
          lunch_start: string
          min_notice_hours: number
          responsible: string
          revision: number
          timezone: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          business_days?: number[]
          calendar_id?: string
          day_end?: string
          day_start?: string
          duration_minutes?: number
          enabled?: boolean
          gap_minutes?: number
          id?: number
          lunch_end?: string
          lunch_start?: string
          min_notice_hours?: number
          responsible?: string
          revision?: number
          timezone?: string
          updated_at?: string
          updated_by?: string
        }
        Update: {
          business_days?: number[]
          calendar_id?: string
          day_end?: string
          day_start?: string
          duration_minutes?: number
          enabled?: boolean
          gap_minutes?: number
          id?: number
          lunch_end?: string
          lunch_start?: string
          min_notice_hours?: number
          responsible?: string
          revision?: number
          timezone?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: []
      }
      crm_campaign_acknowledgements: {
        Row: {
          actor: string
          campaign_id: string
          created_at: string
          id: string
          revision: number
          statement: string
        }
        Insert: {
          actor: string
          campaign_id: string
          created_at?: string
          id?: string
          revision: number
          statement: string
        }
        Update: {
          actor?: string
          campaign_id?: string
          created_at?: string
          id?: string
          revision?: number
          statement?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_campaign_acknowledgements_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "crm_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_campaign_deliveries: {
        Row: {
          batch_id: string
          campaign_id: string
          client_id: string | null
          contact: string
          created_at: string
          error_code: string | null
          id: string
          lead_id: string | null
          provider_message_id: string | null
          recipient_company: string
          recipient_name: string
          scheduled_at: string | null
          state: string
          updated_at: string
        }
        Insert: {
          batch_id: string
          campaign_id: string
          client_id?: string | null
          contact: string
          created_at?: string
          error_code?: string | null
          id?: string
          lead_id?: string | null
          provider_message_id?: string | null
          recipient_company?: string
          recipient_name?: string
          scheduled_at?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          batch_id?: string
          campaign_id?: string
          client_id?: string | null
          contact?: string
          created_at?: string
          error_code?: string | null
          id?: string
          lead_id?: string | null
          provider_message_id?: string | null
          recipient_company?: string
          recipient_name?: string
          scheduled_at?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_campaign_deliveries_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "crm_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_campaign_deliveries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_campaign_email_settings: {
        Row: {
          id: boolean
          reply_to: string
          revision: number
          sender_email: string
          sender_name: string
          timezone: string
          updated_at: string | null
        }
        Insert: {
          id?: boolean
          reply_to?: string
          revision?: number
          sender_email?: string
          sender_name?: string
          timezone?: string
          updated_at?: string | null
        }
        Update: {
          id?: boolean
          reply_to?: string
          revision?: number
          sender_email?: string
          sender_name?: string
          timezone?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      crm_campaign_events: {
        Row: {
          campaign_id: string | null
          channel: string
          created_at: string
          details: Json
          id: string
          kind: string
          lead_id: string | null
        }
        Insert: {
          campaign_id?: string | null
          channel: string
          created_at?: string
          details?: Json
          id?: string
          kind: string
          lead_id?: string | null
        }
        Update: {
          campaign_id?: string | null
          channel?: string
          created_at?: string
          details?: Json
          id?: string
          kind?: string
          lead_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_campaign_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "crm_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_campaign_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_campaign_lists: {
        Row: {
          created_at: string
          id: string
          kind: string
          name: string
          targets: Json
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          name: string
          targets: Json
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          name?: string
          targets?: Json
        }
        Relationships: []
      }
      crm_campaign_permissions: {
        Row: {
          channel: string
          contact: string
          evidence: string
          granted_at: string
          id: string
          lead_id: string
          purpose: string
          recorded_at: string
          withdrawn_at: string | null
        }
        Insert: {
          channel: string
          contact: string
          evidence: string
          granted_at: string
          id?: string
          lead_id: string
          purpose?: string
          recorded_at?: string
          withdrawn_at?: string | null
        }
        Update: {
          channel?: string
          contact?: string
          evidence?: string
          granted_at?: string
          id?: string
          lead_id?: string
          purpose?: string
          recorded_at?: string
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_campaign_permissions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_campaign_send_pacing: {
        Row: {
          campaign_id: string
          max_gap_seconds: number
          min_gap_seconds: number
          next_send_at: string
          pause_every: number
          pause_seconds: number
          sent_since_pause: number
          updated_at: string
        }
        Insert: {
          campaign_id: string
          max_gap_seconds: number
          min_gap_seconds: number
          next_send_at?: string
          pause_every: number
          pause_seconds: number
          sent_since_pause?: number
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          max_gap_seconds?: number
          min_gap_seconds?: number
          next_send_at?: string
          pause_every?: number
          pause_seconds?: number
          sent_since_pause?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_campaign_send_pacing_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: true
            referencedRelation: "crm_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_campaign_templates: {
        Row: {
          body: string
          channel: string
          created_at: string
          id: string
          name: string
          subject: string
        }
        Insert: {
          body: string
          channel: string
          created_at?: string
          id?: string
          name: string
          subject?: string
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string
          id?: string
          name?: string
          subject?: string
        }
        Relationships: []
      }
      crm_campaign_test_recipients: {
        Row: {
          authorized_at: string
          email: string
          evidence: string
          id: string
          label: string
          recorded_by: string
          revoked_at: string | null
        }
        Insert: {
          authorized_at?: string
          email: string
          evidence: string
          id?: string
          label: string
          recorded_by: string
          revoked_at?: string | null
        }
        Update: {
          authorized_at?: string
          email?: string
          evidence?: string
          id?: string
          label?: string
          recorded_by?: string
          revoked_at?: string | null
        }
        Relationships: []
      }
      crm_campaigns: {
        Row: {
          audience_kind: string
          body: string
          channel: string
          client_ids: Json
          created_at: string
          group_targets: Json
          id: string
          instance_reference: string
          lead_ids: Json
          manual_targets: Json
          name: string
          revision: number
          scheduled_at: string | null
          sender_reference: string
          state: string
          subject: string
          updated_at: string
        }
        Insert: {
          audience_kind?: string
          body?: string
          channel: string
          client_ids?: Json
          created_at?: string
          group_targets?: Json
          id?: string
          instance_reference?: string
          lead_ids?: Json
          manual_targets?: Json
          name: string
          revision?: number
          scheduled_at?: string | null
          sender_reference?: string
          state?: string
          subject?: string
          updated_at?: string
        }
        Update: {
          audience_kind?: string
          body?: string
          channel?: string
          client_ids?: Json
          created_at?: string
          group_targets?: Json
          id?: string
          instance_reference?: string
          lead_ids?: Json
          manual_targets?: Json
          name?: string
          revision?: number
          scheduled_at?: string | null
          sender_reference?: string
          state?: string
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
      crm_client_ad_accounts: {
        Row: {
          account_id: string
          account_name: string
          client_id: string
          created_at: string
          created_by: string
          id: string
          platform: string
        }
        Insert: {
          account_id: string
          account_name?: string
          client_id: string
          created_at?: string
          created_by?: string
          id?: string
          platform: string
        }
        Update: {
          account_id?: string
          account_name?: string
          client_id?: string
          created_at?: string
          created_by?: string
          id?: string
          platform?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_client_ad_accounts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_client_charges: {
        Row: {
          amount: number
          client_id: string
          created_at: string
          created_by: string
          description: string
          due_date: string
          id: string
          parent_charge_id: string | null
          payment_method: string
          project_id: string | null
          receipt_schedule_id: string | null
          recurrence: string
          recurrence_interval: number
          revision: number
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          client_id: string
          created_at?: string
          created_by?: string
          description: string
          due_date: string
          id?: string
          parent_charge_id?: string | null
          payment_method?: string
          project_id?: string | null
          receipt_schedule_id?: string | null
          recurrence?: string
          recurrence_interval?: number
          revision?: number
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          client_id?: string
          created_at?: string
          created_by?: string
          description?: string
          due_date?: string
          id?: string
          parent_charge_id?: string | null
          payment_method?: string
          project_id?: string | null
          receipt_schedule_id?: string | null
          recurrence?: string
          recurrence_interval?: number
          revision?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_client_charges_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_client_charges_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "crm_client_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_client_charges_receipt_schedule_id_fkey"
            columns: ["receipt_schedule_id"]
            isOneToOne: false
            referencedRelation: "crm_receipt_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_client_documents: {
        Row: {
          ai_authorized: boolean
          category: string
          client_id: string
          content_type: string
          created_at: string
          created_by: string
          id: string
          name: string
          path: string
          project_id: string | null
          size_bytes: number
        }
        Insert: {
          ai_authorized?: boolean
          category: string
          client_id: string
          content_type?: string
          created_at?: string
          created_by?: string
          id?: string
          name: string
          path: string
          project_id?: string | null
          size_bytes?: number
        }
        Update: {
          ai_authorized?: boolean
          category?: string
          client_id?: string
          content_type?: string
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          path?: string
          project_id?: string | null
          size_bytes?: number
        }
        Relationships: [
          {
            foreignKeyName: "crm_client_documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_client_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "crm_client_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_client_knowledge: {
        Row: {
          client_id: string
          created_at: string
          created_by: string
          id: string
          kind: string
          source: string
          text: string
          title: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string
          id?: string
          kind: string
          source?: string
          text: string
          title?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string
          id?: string
          kind?: string
          source?: string
          text?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_client_knowledge_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_client_metric_prefs: {
        Row: {
          client_id: string
          metrics: Json
          updated_at: string
        }
        Insert: {
          client_id: string
          metrics: Json
          updated_at?: string
        }
        Update: {
          client_id?: string
          metrics?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_client_metric_prefs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "crm_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_client_payments: {
        Row: {
          amount: number
          charge_id: string
          confirmed_by: string
          created_at: string
          finance_account_id: string | null
          finance_operation: string | null
          id: string
          method: string
          note: string
          paid_at: string
        }
        Insert: {
          amount: number
          charge_id: string
          confirmed_by?: string
          created_at?: string
          finance_account_id?: string | null
          finance_operation?: string | null
          id?: string
          method?: string
          note?: string
          paid_at: string
        }
        Update: {
          amount?: number
          charge_id?: string
          confirmed_by?: string
          created_at?: string
          finance_account_id?: string | null
          finance_operation?: string | null
          id?: string
          method?: string
          note?: string
          paid_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_client_payments_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "crm_client_charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_client_payments_finance_account_id_fkey"
            columns: ["finance_account_id"]
            isOneToOne: false
            referencedRelation: "finance_records"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_client_plan_versions: {
        Row: {
          content: string
          created_at: string
          created_by: string
          id: string
          origin: string
          plan_id: string
          version: number
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string
          id?: string
          origin: string
          plan_id: string
          version: number
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string
          id?: string
          origin?: string
          plan_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "crm_client_plan_versions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "crm_client_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_client_plans: {
        Row: {
          approved_version: number | null
          client_id: string
          created_at: string
          created_by: string
          current_version: number
          id: string
          revision: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          approved_version?: number | null
          client_id: string
          created_at?: string
          created_by?: string
          current_version?: number
          id?: string
          revision?: number
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          approved_version?: number | null
          client_id?: string
          created_at?: string
          created_by?: string
          current_version?: number
          id?: string
          revision?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_client_plans_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_client_projects: {
        Row: {
          client_id: string
          created_at: string
          created_by: string
          crm_project_id: string | null
          end_date: string | null
          id: string
          name: string
          objectives: string
          responsible: string
          revision: number
          service: string
          start_date: string | null
          status: string
          strategic_plan: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string
          crm_project_id?: string | null
          end_date?: string | null
          id?: string
          name: string
          objectives?: string
          responsible?: string
          revision?: number
          service?: string
          start_date?: string | null
          status?: string
          strategic_plan?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string
          crm_project_id?: string | null
          end_date?: string | null
          id?: string
          name?: string
          objectives?: string
          responsible?: string
          revision?: number
          service?: string
          start_date?: string | null
          status?: string
          strategic_plan?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_client_projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_client_projects_crm_project_id_fkey"
            columns: ["crm_project_id"]
            isOneToOne: false
            referencedRelation: "crm_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_client_records: {
        Row: {
          author: string
          client_id: string
          created_at: string
          description: string
          id: string
          kind: string
        }
        Insert: {
          author?: string
          client_id: string
          created_at?: string
          description: string
          id?: string
          kind: string
        }
        Update: {
          author?: string
          client_id?: string
          created_at?: string
          description?: string
          id?: string
          kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_client_records_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_client_task_events: {
        Row: {
          action: string
          actor: string
          changes: Json
          client_id: string
          created_at: string
          id: string
          origin: string
          responsible: string
          task_id: string
          title: string
        }
        Insert: {
          action: string
          actor?: string
          changes?: Json
          client_id: string
          created_at?: string
          id?: string
          origin?: string
          responsible?: string
          task_id: string
          title?: string
        }
        Update: {
          action?: string
          actor?: string
          changes?: Json
          client_id?: string
          created_at?: string
          id?: string
          origin?: string
          responsible?: string
          task_id?: string
          title?: string
        }
        Relationships: []
      }
      crm_client_tasks: {
        Row: {
          ai_reason: string
          charge_id: string | null
          client_id: string
          completed_at: string | null
          created_at: string
          created_by: string
          dedupe_key: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string
          due_date: string | null
          id: string
          origin: string
          priority: string
          responsible: string
          revision: number
          source_message_id: string | null
          source_quote: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          ai_reason?: string
          charge_id?: string | null
          client_id: string
          completed_at?: string | null
          created_at?: string
          created_by?: string
          dedupe_key?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string
          due_date?: string | null
          id?: string
          origin?: string
          priority?: string
          responsible?: string
          revision?: number
          source_message_id?: string | null
          source_quote?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          ai_reason?: string
          charge_id?: string | null
          client_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string
          dedupe_key?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string
          due_date?: string | null
          id?: string
          origin?: string
          priority?: string
          responsible?: string
          revision?: number
          source_message_id?: string | null
          source_quote?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_client_tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_clients: {
        Row: {
          address: string
          cnpj: string
          contact_name: string
          created_at: string
          created_by: string
          email: string
          id: string
          internal_responsible: string
          lead_id: string | null
          legal_name: string
          notes: string
          phone: string
          relationship_start: string | null
          reminder_days: number
          revision: number
          services: string[]
          status: string
          trade_name: string
          updated_at: string
          website: string
          whatsapp: string
        }
        Insert: {
          address?: string
          cnpj?: string
          contact_name?: string
          created_at?: string
          created_by?: string
          email?: string
          id?: string
          internal_responsible?: string
          lead_id?: string | null
          legal_name?: string
          notes?: string
          phone?: string
          relationship_start?: string | null
          reminder_days?: number
          revision?: number
          services?: string[]
          status?: string
          trade_name: string
          updated_at?: string
          website?: string
          whatsapp?: string
        }
        Update: {
          address?: string
          cnpj?: string
          contact_name?: string
          created_at?: string
          created_by?: string
          email?: string
          id?: string
          internal_responsible?: string
          lead_id?: string | null
          legal_name?: string
          notes?: string
          phone?: string
          relationship_start?: string | null
          reminder_days?: number
          revision?: number
          services?: string[]
          status?: string
          trade_name?: string
          updated_at?: string
          website?: string
          whatsapp?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_clients_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_cs_evaluations: {
        Row: {
          client_id: string
          completed_at: string | null
          created_at: string
          diagnosis: Json | null
          event_id: string
          id: string
          limitation: string
          message_count: number
          period_end: string | null
          period_start: string | null
          source_revision: number
          status: string
        }
        Insert: {
          client_id: string
          completed_at?: string | null
          created_at?: string
          diagnosis?: Json | null
          event_id: string
          id?: string
          limitation?: string
          message_count?: number
          period_end?: string | null
          period_start?: string | null
          source_revision?: number
          status?: string
        }
        Update: {
          client_id?: string
          completed_at?: string | null
          created_at?: string
          diagnosis?: Json | null
          event_id?: string
          id?: string
          limitation?: string
          message_count?: number
          period_end?: string | null
          period_start?: string | null
          source_revision?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_cs_evaluations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_cs_history: {
        Row: {
          actor: string
          after_state: Json
          before_state: Json
          client_id: string
          created_at: string
          evaluation_id: string | null
          event_id: string
          id: string
          kind: string
          note: string
        }
        Insert: {
          actor: string
          after_state: Json
          before_state: Json
          client_id: string
          created_at?: string
          evaluation_id?: string | null
          event_id: string
          id?: string
          kind: string
          note?: string
        }
        Update: {
          actor?: string
          after_state?: Json
          before_state?: Json
          client_id?: string
          created_at?: string
          evaluation_id?: string | null
          event_id?: string
          id?: string
          kind?: string
          note?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_cs_history_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_cs_history_evaluation_id_fkey"
            columns: ["evaluation_id"]
            isOneToOne: false
            referencedRelation: "crm_cs_evaluations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_customer_success: {
        Row: {
          client_id: string
          health: string | null
          last_followup_at: string | null
          management: Json
          revision: number
          stage: string
          updated_at: string
        }
        Insert: {
          client_id: string
          health?: string | null
          last_followup_at?: string | null
          management?: Json
          revision?: number
          stage?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          health?: string | null
          last_followup_at?: string | null
          management?: Json
          revision?: number
          stage?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_customer_success_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "crm_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_diagnosis_automation_settings: {
        Row: {
          activated_at: string | null
          authorized_by: string | null
          enabled: boolean
          id: boolean
          instance: string
          revision: number
          sender_phone: string
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          authorized_by?: string | null
          enabled?: boolean
          id?: boolean
          instance?: string
          revision?: number
          sender_phone?: string
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          authorized_by?: string | null
          enabled?: boolean
          id?: boolean
          instance?: string
          revision?: number
          sender_phone?: string
          updated_at?: string
        }
        Relationships: []
      }
      crm_diagnosis_submissions: {
        Row: {
          api_key_id: string | null
          company: string
          email: string
          event_id: string
          id: string
          lead_id: string | null
          name: string
          objective: string
          outcome: string
          paused_count: number
          received_at: string
          utm_content: string
          whatsapp: string
          whatsapp_consent: Json | null
        }
        Insert: {
          api_key_id?: string | null
          company?: string
          email?: string
          event_id: string
          id?: string
          lead_id?: string | null
          name?: string
          objective?: string
          outcome?: string
          paused_count?: number
          received_at?: string
          utm_content?: string
          whatsapp?: string
          whatsapp_consent?: Json | null
        }
        Update: {
          api_key_id?: string | null
          company?: string
          email?: string
          event_id?: string
          id?: string
          lead_id?: string | null
          name?: string
          objective?: string
          outcome?: string
          paused_count?: number
          received_at?: string
          utm_content?: string
          whatsapp?: string
          whatsapp_consent?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_diagnosis_submissions_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "crm_api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_diagnosis_submissions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_diagnosis_whatsapp: {
        Row: {
          accepted_at: string | null
          body: string
          created_at: string
          error_code: string
          id: string
          instance: string
          lead_id: string
          lease: string | null
          lease_until: string | null
          persisted_at: string | null
          phone: string
          provider_id: string | null
          remote_jid: string | null
          sender_phone: string
          settings_revision: number
          state: string
          submission_id: string
        }
        Insert: {
          accepted_at?: string | null
          body: string
          created_at?: string
          error_code?: string
          id?: string
          instance: string
          lead_id: string
          lease?: string | null
          lease_until?: string | null
          persisted_at?: string | null
          phone: string
          provider_id?: string | null
          remote_jid?: string | null
          sender_phone: string
          settings_revision: number
          state?: string
          submission_id: string
        }
        Update: {
          accepted_at?: string | null
          body?: string
          created_at?: string
          error_code?: string
          id?: string
          instance?: string
          lead_id?: string
          lease?: string | null
          lease_until?: string | null
          persisted_at?: string | null
          phone?: string
          provider_id?: string | null
          remote_jid?: string | null
          sender_phone?: string
          settings_revision?: number
          state?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_diagnosis_whatsapp_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_diagnosis_whatsapp_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: true
            referencedRelation: "crm_diagnosis_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_email_flow_enrollments: {
        Row: {
          contact: string
          created_at: string
          flow_id: string
          id: string
          last_sent_at: string | null
          lead_id: string
          next_send_at: string | null
          next_step: number
          reason: string
          replied_at: string | null
          started_at: string
          status: string
          updated_at: string
        }
        Insert: {
          contact: string
          created_at?: string
          flow_id: string
          id?: string
          last_sent_at?: string | null
          lead_id: string
          next_send_at?: string | null
          next_step?: number
          reason?: string
          replied_at?: string | null
          started_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          contact?: string
          created_at?: string
          flow_id?: string
          id?: string
          last_sent_at?: string | null
          lead_id?: string
          next_send_at?: string | null
          next_step?: number
          reason?: string
          replied_at?: string | null
          started_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_email_flow_enrollments_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "crm_email_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_email_flow_enrollments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_email_flow_messages: {
        Row: {
          ai_personalized: boolean
          body: string
          contact: string
          created_at: string
          direction: string
          enrollment_id: string
          error_code: string | null
          flow_id: string
          gmail_message_id: string | null
          id: string
          kind: string
          lead_id: string | null
          provider_message_id: string | null
          rfc_message_id: string | null
          state: string
          step: number | null
          subject: string
          updated_at: string
        }
        Insert: {
          ai_personalized?: boolean
          body?: string
          contact: string
          created_at?: string
          direction: string
          enrollment_id: string
          error_code?: string | null
          flow_id: string
          gmail_message_id?: string | null
          id?: string
          kind: string
          lead_id?: string | null
          provider_message_id?: string | null
          rfc_message_id?: string | null
          state: string
          step?: number | null
          subject?: string
          updated_at?: string
        }
        Update: {
          ai_personalized?: boolean
          body?: string
          contact?: string
          created_at?: string
          direction?: string
          enrollment_id?: string
          error_code?: string | null
          flow_id?: string
          gmail_message_id?: string | null
          id?: string
          kind?: string
          lead_id?: string | null
          provider_message_id?: string | null
          rfc_message_id?: string | null
          state?: string
          step?: number | null
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_email_flow_messages_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "crm_email_flow_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_email_flow_messages_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "crm_email_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_email_flow_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_email_flow_runner: {
        Row: {
          agent_enabled: boolean
          ai_blocked_reason: string
          gmail_checked_at: string | null
          id: boolean
          inbox_error: string
          inbox_synced_at: string | null
          last_result: Json
          last_run_at: string | null
          lease_token: string | null
          lease_until: string | null
          token: string
        }
        Insert: {
          agent_enabled?: boolean
          ai_blocked_reason?: string
          gmail_checked_at?: string | null
          id?: boolean
          inbox_error?: string
          inbox_synced_at?: string | null
          last_result?: Json
          last_run_at?: string | null
          lease_token?: string | null
          lease_until?: string | null
          token?: string
        }
        Update: {
          agent_enabled?: boolean
          ai_blocked_reason?: string
          gmail_checked_at?: string | null
          id?: boolean
          inbox_error?: string
          inbox_synced_at?: string | null
          last_result?: Json
          last_run_at?: string | null
          lease_token?: string | null
          lease_until?: string | null
          token?: string
        }
        Relationships: []
      }
      crm_email_flow_suggestions: {
        Row: {
          analysis: string
          body: string
          created_at: string
          enrollment_id: string
          id: string
          inbound_id: string
          lead_id: string | null
          revision: number
          sent_message_id: string | null
          state: string
          subject: string
          updated_at: string
        }
        Insert: {
          analysis?: string
          body?: string
          created_at?: string
          enrollment_id: string
          id?: string
          inbound_id: string
          lead_id?: string | null
          revision?: number
          sent_message_id?: string | null
          state?: string
          subject?: string
          updated_at?: string
        }
        Update: {
          analysis?: string
          body?: string
          created_at?: string
          enrollment_id?: string
          id?: string
          inbound_id?: string
          lead_id?: string | null
          revision?: number
          sent_message_id?: string | null
          state?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_email_flow_suggestions_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "crm_email_flow_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_email_flow_suggestions_inbound_id_fkey"
            columns: ["inbound_id"]
            isOneToOne: true
            referencedRelation: "crm_email_flow_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_email_flow_suggestions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_email_flow_suggestions_sent_message_id_fkey"
            columns: ["sent_message_id"]
            isOneToOne: false
            referencedRelation: "crm_email_flow_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_email_flows: {
        Row: {
          ai_approved_at: string | null
          ai_approved_revision: number | null
          ai_enabled: boolean
          automation_id: string | null
          created_at: string
          id: string
          max_messages: number
          name: string
          revision: number
          send_days: number[]
          send_end: string
          send_start: string
          state: string
          steps: Json
          updated_at: string
        }
        Insert: {
          ai_approved_at?: string | null
          ai_approved_revision?: number | null
          ai_enabled?: boolean
          automation_id?: string | null
          created_at?: string
          id?: string
          max_messages?: number
          name: string
          revision?: number
          send_days?: number[]
          send_end?: string
          send_start?: string
          state?: string
          steps?: Json
          updated_at?: string
        }
        Update: {
          ai_approved_at?: string | null
          ai_approved_revision?: number | null
          ai_enabled?: boolean
          automation_id?: string | null
          created_at?: string
          id?: string
          max_messages?: number
          name?: string
          revision?: number
          send_days?: number[]
          send_end?: string
          send_start?: string
          state?: string
          steps?: Json
          updated_at?: string
        }
        Relationships: []
      }
      crm_email_inbox: {
        Row: {
          body: string
          created_at: string
          from_address: string
          from_name: string
          gmail_message_id: string
          gmail_thread_id: string | null
          id: string
          lead_id: string | null
          match: string
          received_at: string
          rfc_message_id: string | null
          status: string
          subject: string
          to_address: string
          unread: boolean
          updated_at: string
        }
        Insert: {
          body?: string
          created_at?: string
          from_address: string
          from_name?: string
          gmail_message_id: string
          gmail_thread_id?: string | null
          id?: string
          lead_id?: string | null
          match?: string
          received_at: string
          rfc_message_id?: string | null
          status?: string
          subject?: string
          to_address?: string
          unread?: boolean
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          from_address?: string
          from_name?: string
          gmail_message_id?: string
          gmail_thread_id?: string | null
          id?: string
          lead_id?: string | null
          match?: string
          received_at?: string
          rfc_message_id?: string | null
          status?: string
          subject?: string
          to_address?: string
          unread?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_email_inbox_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_external_integrations: {
        Row: {
          auth_header: string | null
          auth_method: string
          auto_sync: boolean
          base_url: string | null
          config: Json
          created_at: string
          encrypted_credentials: string | null
          encrypted_transactions_credentials: string | null
          endpoints: Json
          id: string
          last_check_at: string | null
          last_check_status: string | null
          last_sync_at: string | null
          last_sync_status: string | null
          name: string
          provider: string
          revision: number
          status: string
          sync_lease: string | null
          sync_lease_until: string | null
          transactions_check_at: string | null
          transactions_check_status: string | null
          updated_at: string
        }
        Insert: {
          auth_header?: string | null
          auth_method?: string
          auto_sync?: boolean
          base_url?: string | null
          config?: Json
          created_at?: string
          encrypted_credentials?: string | null
          encrypted_transactions_credentials?: string | null
          endpoints?: Json
          id?: string
          last_check_at?: string | null
          last_check_status?: string | null
          last_sync_at?: string | null
          last_sync_status?: string | null
          name?: string
          provider: string
          revision?: number
          status?: string
          sync_lease?: string | null
          sync_lease_until?: string | null
          transactions_check_at?: string | null
          transactions_check_status?: string | null
          updated_at?: string
        }
        Update: {
          auth_header?: string | null
          auth_method?: string
          auto_sync?: boolean
          base_url?: string | null
          config?: Json
          created_at?: string
          encrypted_credentials?: string | null
          encrypted_transactions_credentials?: string | null
          endpoints?: Json
          id?: string
          last_check_at?: string | null
          last_check_status?: string | null
          last_sync_at?: string | null
          last_sync_status?: string | null
          name?: string
          provider?: string
          revision?: number
          status?: string
          sync_lease?: string | null
          sync_lease_until?: string | null
          transactions_check_at?: string | null
          transactions_check_status?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      crm_hypercash_audit: {
        Row: {
          actor: string
          after_data: Json
          before_data: Json | null
          charge_id: string | null
          created_at: string
          event: string
          id: string
          subscription_id: string | null
        }
        Insert: {
          actor: string
          after_data: Json
          before_data?: Json | null
          charge_id?: string | null
          created_at?: string
          event: string
          id?: string
          subscription_id?: string | null
        }
        Update: {
          actor?: string
          after_data?: Json
          before_data?: Json | null
          charge_id?: string | null
          created_at?: string
          event?: string
          id?: string
          subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_hypercash_audit_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "crm_hypercash_charges"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_hypercash_charges: {
        Row: {
          amount_cents: number
          billing_date: string | null
          charge_id: string
          client_id: string | null
          customer_email: string | null
          customer_name: string | null
          finance_charge_id: string | null
          finance_payment_id: string | null
          id: string
          order_id: string | null
          paid_at: string | null
          status: string
          subscription_id: string | null
          synced_at: string
          transaction_id: string | null
        }
        Insert: {
          amount_cents?: number
          billing_date?: string | null
          charge_id: string
          client_id?: string | null
          customer_email?: string | null
          customer_name?: string | null
          finance_charge_id?: string | null
          finance_payment_id?: string | null
          id?: string
          order_id?: string | null
          paid_at?: string | null
          status?: string
          subscription_id?: string | null
          synced_at?: string
          transaction_id?: string | null
        }
        Update: {
          amount_cents?: number
          billing_date?: string | null
          charge_id?: string
          client_id?: string | null
          customer_email?: string | null
          customer_name?: string | null
          finance_charge_id?: string | null
          finance_payment_id?: string | null
          id?: string
          order_id?: string | null
          paid_at?: string | null
          status?: string
          subscription_id?: string | null
          synced_at?: string
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_hypercash_charges_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_hypercash_charges_finance_charge_id_fkey"
            columns: ["finance_charge_id"]
            isOneToOne: false
            referencedRelation: "crm_client_charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_hypercash_charges_finance_payment_id_fkey"
            columns: ["finance_payment_id"]
            isOneToOne: false
            referencedRelation: "crm_client_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_hypercash_payout_links: {
        Row: {
          actor: string
          bank_transaction_id: string
          charge_id: string
          company_key: string
          created_at: string
          fee_cents: number
          gross_cents: number
        }
        Insert: {
          actor: string
          bank_transaction_id: string
          charge_id: string
          company_key: string
          created_at?: string
          fee_cents: number
          gross_cents: number
        }
        Update: {
          actor?: string
          bank_transaction_id?: string
          charge_id?: string
          company_key?: string
          created_at?: string
          fee_cents?: number
          gross_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "crm_hypercash_payout_links_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: true
            referencedRelation: "crm_hypercash_charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_hypercash_payout_links_company_key_bank_transaction_id_fkey"
            columns: ["company_key", "bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "polp_bank_transactions"
            referencedColumns: ["company_key", "polp_transaction_id"]
          },
        ]
      }
      crm_hypercash_subscriptions: {
        Row: {
          amount_cents: number | null
          client_id: string | null
          customer_email: string | null
          customer_name: string | null
          frequency: string | null
          id: string
          last_payment_at: string | null
          next_billing_date: string | null
          payment_method: string | null
          product_name: string | null
          status: string | null
          subscription_id: string
          synced_at: string
        }
        Insert: {
          amount_cents?: number | null
          client_id?: string | null
          customer_email?: string | null
          customer_name?: string | null
          frequency?: string | null
          id?: string
          last_payment_at?: string | null
          next_billing_date?: string | null
          payment_method?: string | null
          product_name?: string | null
          status?: string | null
          subscription_id: string
          synced_at?: string
        }
        Update: {
          amount_cents?: number | null
          client_id?: string | null
          customer_email?: string | null
          customer_name?: string | null
          frequency?: string | null
          id?: string
          last_payment_at?: string | null
          next_billing_date?: string | null
          payment_method?: string | null
          product_name?: string | null
          status?: string | null
          subscription_id?: string
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_hypercash_subscriptions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_hypercash_sync_log: {
        Row: {
          charges_count: number
          finished_at: string | null
          id: string
          integration_id: string
          message: string
          outcome: string
          started_at: string
          subscriptions_count: number
        }
        Insert: {
          charges_count?: number
          finished_at?: string | null
          id?: string
          integration_id: string
          message?: string
          outcome?: string
          started_at?: string
          subscriptions_count?: number
        }
        Update: {
          charges_count?: number
          finished_at?: string | null
          id?: string
          integration_id?: string
          message?: string
          outcome?: string
          started_at?: string
          subscriptions_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "crm_hypercash_sync_log_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "crm_external_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_meta_ad_accounts: {
        Row: {
          accessible: boolean
          account_id: string
          account_name: string
          account_status: number | null
          added_by: string
          business_id: string
          business_name: string
          created_at: string
          last_synced_at: string
        }
        Insert: {
          accessible?: boolean
          account_id: string
          account_name?: string
          account_status?: number | null
          added_by?: string
          business_id?: string
          business_name?: string
          created_at?: string
          last_synced_at?: string
        }
        Update: {
          accessible?: boolean
          account_id?: string
          account_name?: string
          account_status?: number | null
          added_by?: string
          business_id?: string
          business_name?: string
          created_at?: string
          last_synced_at?: string
        }
        Relationships: []
      }
      crm_notification_log: {
        Row: {
          body: string
          channel: string
          created_at: string
          error: string
          event: string
          event_key: string
          id: string
          sent_at: string | null
          status: string
          title: string
          url: string
        }
        Insert: {
          body?: string
          channel: string
          created_at?: string
          error?: string
          event: string
          event_key: string
          id?: string
          sent_at?: string | null
          status?: string
          title?: string
          url?: string
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string
          error?: string
          event?: string
          event_key?: string
          id?: string
          sent_at?: string | null
          status?: string
          title?: string
          url?: string
        }
        Relationships: []
      }
      crm_notification_prefs: {
        Row: {
          channel: string
          enabled: boolean
          event: string
          updated_at: string
        }
        Insert: {
          channel: string
          enabled?: boolean
          event: string
          updated_at?: string
        }
        Update: {
          channel?: string
          enabled?: boolean
          event?: string
          updated_at?: string
        }
        Relationships: []
      }
      crm_notification_settings: {
        Row: {
          email_target: string
          id: boolean
          updated_at: string
          whatsapp_target: string
        }
        Insert: {
          email_target?: string
          id?: boolean
          updated_at?: string
          whatsapp_target?: string
        }
        Update: {
          email_target?: string
          id?: boolean
          updated_at?: string
          whatsapp_target?: string
        }
        Relationships: []
      }
      crm_outbound_email_clicks: {
        Row: {
          classification: string
          created_at: string
          fingerprint: string
          id: string
          link_id: string
        }
        Insert: {
          classification: string
          created_at?: string
          fingerprint: string
          id?: string
          link_id: string
        }
        Update: {
          classification?: string
          created_at?: string
          fingerprint?: string
          id?: string
          link_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_outbound_email_clicks_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "crm_outbound_email_links"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_outbound_email_links: {
        Row: {
          company_key: string
          created_at: string
          id: string
          lead_id: string
          message_id: string | null
          subject: string
          test: boolean
          test_accepted: boolean
          token: string
          url: string
        }
        Insert: {
          company_key?: string
          created_at?: string
          id?: string
          lead_id: string
          message_id?: string | null
          subject?: string
          test?: boolean
          test_accepted?: boolean
          token?: string
          url: string
        }
        Update: {
          company_key?: string
          created_at?: string
          id?: string
          lead_id?: string
          message_id?: string | null
          subject?: string
          test?: boolean
          test_accepted?: boolean
          token?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_outbound_email_links_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_outbound_email_links_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "crm_email_flow_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_profile: {
        Row: {
          company_key: string
          display_name: string
          email: string
          photo: string | null
          revision: number
          updated_at: string
        }
        Insert: {
          company_key: string
          display_name?: string
          email?: string
          photo?: string | null
          revision?: number
          updated_at?: string
        }
        Update: {
          company_key?: string
          display_name?: string
          email?: string
          photo?: string | null
          revision?: number
          updated_at?: string
        }
        Relationships: []
      }
      crm_project_history: {
        Row: {
          actor: string
          company_key: string
          content: string
          created_at: string
          event_id: string
          id: string
          kind: string
          project_id: string
          snapshot: Json | null
        }
        Insert: {
          actor: string
          company_key?: string
          content: string
          created_at?: string
          event_id: string
          id?: string
          kind: string
          project_id: string
          snapshot?: Json | null
        }
        Update: {
          actor?: string
          company_key?: string
          content?: string
          created_at?: string
          event_id?: string
          id?: string
          kind?: string
          project_id?: string
          snapshot?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_project_history_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "crm_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_projects: {
        Row: {
          category: string
          company_key: string
          created_at: string
          description: string
          id: string
          name: string
          next_action: string
          objective: string
          priority: string
          responsible: string
          revision: number
          seed_key: string | null
          status: string
          tasks: Json
          technical_pending: string
          test_results: string
          updated_at: string
        }
        Insert: {
          category?: string
          company_key?: string
          created_at?: string
          description?: string
          id?: string
          name: string
          next_action?: string
          objective?: string
          priority?: string
          responsible?: string
          revision?: number
          seed_key?: string | null
          status?: string
          tasks?: Json
          technical_pending?: string
          test_results?: string
          updated_at?: string
        }
        Update: {
          category?: string
          company_key?: string
          created_at?: string
          description?: string
          id?: string
          name?: string
          next_action?: string
          objective?: string
          priority?: string
          responsible?: string
          revision?: number
          seed_key?: string | null
          status?: string
          tasks?: Json
          technical_pending?: string
          test_results?: string
          updated_at?: string
        }
        Relationships: []
      }
      crm_push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          disabled_at: string | null
          endpoint: string
          id: string
          last_used_at: string | null
          p256dh: string
          user_agent: string
        }
        Insert: {
          auth: string
          created_at?: string
          disabled_at?: string | null
          endpoint: string
          id?: string
          last_used_at?: string | null
          p256dh: string
          user_agent?: string
        }
        Update: {
          auth?: string
          created_at?: string
          disabled_at?: string | null
          endpoint?: string
          id?: string
          last_used_at?: string | null
          p256dh?: string
          user_agent?: string
        }
        Relationships: []
      }
      crm_receipt_audit: {
        Row: {
          actor: string
          after_data: Json | null
          before_data: Json | null
          created_at: string
          entity_id: string
          id: string
          kind: string
          operation: string | null
        }
        Insert: {
          actor: string
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id: string
          id?: string
          kind: string
          operation?: string | null
        }
        Update: {
          actor?: string
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id?: string
          id?: string
          kind?: string
          operation?: string | null
        }
        Relationships: []
      }
      crm_receipt_schedules: {
        Row: {
          client_id: string
          config: Json
          created_at: string
          id: string
          operation: string
          project_id: string | null
          revision: number
          updated_at: string
        }
        Insert: {
          client_id: string
          config: Json
          created_at?: string
          id?: string
          operation: string
          project_id?: string | null
          revision?: number
          updated_at?: string
        }
        Update: {
          client_id?: string
          config?: Json
          created_at?: string
          id?: string
          operation?: string
          project_id?: string | null
          revision?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_receipt_schedules_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_receipt_schedules_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "crm_client_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_reference_captures: {
        Row: {
          contact_key: string
          created_at: string
          instance: string
          lead_id: string | null
          message_id: string
          pipeline_id: string | null
          reference_id: string | null
          source: string
          status: string
        }
        Insert: {
          contact_key: string
          created_at?: string
          instance: string
          lead_id?: string | null
          message_id: string
          pipeline_id?: string | null
          reference_id?: string | null
          source: string
          status: string
        }
        Update: {
          contact_key?: string
          created_at?: string
          instance?: string
          lead_id?: string | null
          message_id?: string
          pipeline_id?: string | null
          reference_id?: string | null
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_reference_captures_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "crm_reference_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_reference_messages: {
        Row: {
          active: boolean
          body: string
          created_at: string
          id: string
          match_mode: string
          normalized_body: string | null
          pipeline_id: string | null
          revision: number
          source: string
          stage_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          body: string
          created_at?: string
          id?: string
          match_mode?: string
          normalized_body?: string | null
          pipeline_id?: string | null
          revision?: number
          source: string
          stage_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          body?: string
          created_at?: string
          id?: string
          match_mode?: string
          normalized_body?: string | null
          pipeline_id?: string | null
          revision?: number
          source?: string
          stage_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_reference_messages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "sales_pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_settings: {
        Row: {
          id: number
          updated_at: string
          zapier_webhook_url: string | null
        }
        Insert: {
          id?: number
          updated_at?: string
          zapier_webhook_url?: string | null
        }
        Update: {
          id?: number
          updated_at?: string
          zapier_webhook_url?: string | null
        }
        Relationships: []
      }
      crm_task_orders: {
        Row: {
          context: string
          position: number
          task_id: string
        }
        Insert: {
          context: string
          position: number
          task_id: string
        }
        Update: {
          context?: string
          position?: number
          task_id?: string
        }
        Relationships: []
      }
      crm_whatsapp_group_snapshots: {
        Row: {
          binding_phone: string
          company_key: string
          error_code: string | null
          groups: Json
          instance: string
          lease_token: string | null
          lease_until: string | null
          synced_at: string | null
        }
        Insert: {
          binding_phone: string
          company_key: string
          error_code?: string | null
          groups?: Json
          instance: string
          lease_token?: string | null
          lease_until?: string | null
          synced_at?: string | null
        }
        Update: {
          binding_phone?: string
          company_key?: string
          error_code?: string | null
          groups?: Json
          instance?: string
          lease_token?: string | null
          lease_until?: string | null
          synced_at?: string | null
        }
        Relationships: []
      }
      crm_whatsapp_group_tag_links: {
        Row: {
          created_at: string
          group_jid: string
          instance: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          group_jid: string
          instance: string
          tag_id: string
        }
        Update: {
          created_at?: string
          group_jid?: string
          instance?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_whatsapp_group_tag_links_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "crm_whatsapp_group_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_whatsapp_group_tags: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      finance_audit: {
        Row: {
          action: string
          actor: string
          after_data: Json
          before_data: Json | null
          created_at: string
          id: string
          operation: string
          record_id: string
          scope: string
        }
        Insert: {
          action: string
          actor: string
          after_data: Json
          before_data?: Json | null
          created_at?: string
          id?: string
          operation: string
          record_id: string
          scope: string
        }
        Update: {
          action?: string
          actor?: string
          after_data?: Json
          before_data?: Json | null
          created_at?: string
          id?: string
          operation?: string
          record_id?: string
          scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_audit_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "finance_records"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_records: {
        Row: {
          created_at: string
          data: Json
          id: string
          initial_key: string | null
          kind: string
          revision: number
          scope: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          data: Json
          id?: string
          initial_key?: string | null
          kind: string
          revision?: number
          scope: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          initial_key?: string | null
          kind?: string
          revision?: number
          scope?: string
          updated_at?: string
        }
        Relationships: []
      }
      first_contact_attempts: {
        Row: {
          accepted_at: string | null
          attempted_at: string
          body: string
          error_code: string | null
          id: string
          provider_id: string | null
          recovery_count: number
          recovery_due_at: string | null
          sequence_id: string
          state: string
          step: number
        }
        Insert: {
          accepted_at?: string | null
          attempted_at?: string
          body: string
          error_code?: string | null
          id?: string
          provider_id?: string | null
          recovery_count?: number
          recovery_due_at?: string | null
          sequence_id: string
          state?: string
          step: number
        }
        Update: {
          accepted_at?: string | null
          attempted_at?: string
          body?: string
          error_code?: string | null
          id?: string
          provider_id?: string | null
          recovery_count?: number
          recovery_due_at?: string | null
          sequence_id?: string
          state?: string
          step?: number
        }
        Relationships: [
          {
            foreignKeyName: "first_contact_attempts_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "first_contact_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      first_contact_full_test_attempts: {
        Row: {
          accepted_at: string | null
          attempted_at: string
          body: string
          error_code: string | null
          id: string
          persisted_at: string | null
          provider_id: string | null
          remote_jid: string | null
          state: string
          step: number
          test_id: string
        }
        Insert: {
          accepted_at?: string | null
          attempted_at?: string
          body: string
          error_code?: string | null
          id?: string
          persisted_at?: string | null
          provider_id?: string | null
          remote_jid?: string | null
          state: string
          step: number
          test_id: string
        }
        Update: {
          accepted_at?: string | null
          attempted_at?: string
          body?: string
          error_code?: string | null
          id?: string
          persisted_at?: string | null
          provider_id?: string | null
          remote_jid?: string | null
          state?: string
          step?: number
          test_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "first_contact_full_test_attempts_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "first_contact_full_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      first_contact_full_tests: {
        Row: {
          author: string
          company_key: string
          completed_at: string | null
          consent_at: string
          due_at: string
          first_name: string
          id: string
          instance: string
          next_step: number
          phone: string
          reason: string | null
          sender_phone: string
          started_at: string
          state: string
        }
        Insert: {
          author: string
          company_key?: string
          completed_at?: string | null
          consent_at?: string
          due_at?: string
          first_name: string
          id?: string
          instance: string
          next_step?: number
          phone: string
          reason?: string | null
          sender_phone: string
          started_at?: string
          state?: string
        }
        Update: {
          author?: string
          company_key?: string
          completed_at?: string | null
          consent_at?: string
          due_at?: string
          first_name?: string
          id?: string
          instance?: string
          next_step?: number
          phone?: string
          reason?: string | null
          sender_phone?: string
          started_at?: string
          state?: string
        }
        Relationships: []
      }
      first_contact_sequences: {
        Row: {
          company_key: string
          completed_at: string | null
          consent_at: string
          consent_version: string
          contact_key: string
          due_at: string
          first_name: string
          form_origin: string
          id: string
          inbound_id: string | null
          instance: string
          lead_id: string
          lead_name: string
          lease_id: string | null
          lease_until: string | null
          moved_at: string | null
          next_step: number
          phone: string
          reason: string | null
          sender_phone: string
          settings_revision: string
          started_at: string
          state: string
          submission_id: string
        }
        Insert: {
          company_key?: string
          completed_at?: string | null
          consent_at: string
          consent_version: string
          contact_key: string
          due_at?: string
          first_name: string
          form_origin: string
          id?: string
          inbound_id?: string | null
          instance: string
          lead_id: string
          lead_name: string
          lease_id?: string | null
          lease_until?: string | null
          moved_at?: string | null
          next_step?: number
          phone: string
          reason?: string | null
          sender_phone: string
          settings_revision: string
          started_at?: string
          state?: string
          submission_id: string
        }
        Update: {
          company_key?: string
          completed_at?: string | null
          consent_at?: string
          consent_version?: string
          contact_key?: string
          due_at?: string
          first_name?: string
          form_origin?: string
          id?: string
          inbound_id?: string | null
          instance?: string
          lead_id?: string
          lead_name?: string
          lease_id?: string | null
          lease_until?: string | null
          moved_at?: string | null
          next_step?: number
          phone?: string
          reason?: string | null
          sender_phone?: string
          settings_revision?: string
          started_at?: string
          state?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "first_contact_sequences_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      first_contact_settings: {
        Row: {
          authorized_by: string | null
          company_key: string
          enabled: boolean
          enrollment_after: string | null
          instance: string
          interval_seconds: number
          job_secret: string | null
          revision: string
          runtime_ready: boolean
          sender_phone: string
          stop_on_reply: boolean
          updated_at: string
          wake_at: string | null
        }
        Insert: {
          authorized_by?: string | null
          company_key?: string
          enabled?: boolean
          enrollment_after?: string | null
          instance?: string
          interval_seconds?: number
          job_secret?: string | null
          revision?: string
          runtime_ready?: boolean
          sender_phone?: string
          stop_on_reply?: boolean
          updated_at?: string
          wake_at?: string | null
        }
        Update: {
          authorized_by?: string | null
          company_key?: string
          enabled?: boolean
          enrollment_after?: string | null
          instance?: string
          interval_seconds?: number
          job_secret?: string | null
          revision?: string
          runtime_ready?: boolean
          sender_phone?: string
          stop_on_reply?: boolean
          updated_at?: string
          wake_at?: string | null
        }
        Relationships: []
      }
      first_contact_tests: {
        Row: {
          accepted_at: string | null
          author: string
          body: string
          company_key: string
          consent_at: string
          created_at: string
          error_code: string | null
          first_name: string
          id: string
          instance: string
          persisted_at: string | null
          phone: string
          provider_id: string | null
          remote_jid: string | null
          sender_phone: string
          state: string
        }
        Insert: {
          accepted_at?: string | null
          author: string
          body: string
          company_key?: string
          consent_at?: string
          created_at?: string
          error_code?: string | null
          first_name: string
          id?: string
          instance: string
          persisted_at?: string | null
          phone: string
          provider_id?: string | null
          remote_jid?: string | null
          sender_phone: string
          state?: string
        }
        Update: {
          accepted_at?: string | null
          author?: string
          body?: string
          company_key?: string
          consent_at?: string
          created_at?: string
          error_code?: string | null
          first_name?: string
          id?: string
          instance?: string
          persisted_at?: string | null
          phone?: string
          provider_id?: string | null
          remote_jid?: string | null
          sender_phone?: string
          state?: string
        }
        Relationships: []
      }
      first_contact_worker_lock: {
        Row: {
          expires_at: string | null
          id: boolean
          lease: string | null
        }
        Insert: {
          expires_at?: string | null
          id?: boolean
          lease?: string | null
        }
        Update: {
          expires_at?: string | null
          id?: boolean
          lease?: string | null
        }
        Relationships: []
      }
      gravon_ai_test_log: {
        Row: {
          accepted_at: string | null
          body: string
          created_at: string
          delivered_at: string | null
          detail: string
          event: string
          id: string
          inbound_id: string | null
          instance: string | null
          outbound_id: string | null
          phone: string
          remote_jid: string | null
          status: string
        }
        Insert: {
          accepted_at?: string | null
          body?: string
          created_at?: string
          delivered_at?: string | null
          detail?: string
          event: string
          id?: string
          inbound_id?: string | null
          instance?: string | null
          outbound_id?: string | null
          phone?: string
          remote_jid?: string | null
          status?: string
        }
        Update: {
          accepted_at?: string | null
          body?: string
          created_at?: string
          delivered_at?: string | null
          detail?: string
          event?: string
          id?: string
          inbound_id?: string | null
          instance?: string | null
          outbound_id?: string | null
          phone?: string
          remote_jid?: string | null
          status?: string
        }
        Relationships: []
      }
      gravon_ai_test_settings: {
        Row: {
          authorized_phone: string
          crm_finance_authorized_phone: string
          crm_finance_enabled: boolean
          crm_finance_instance: string
          crm_finance_phone: string
          crm_finance_read_revision: string
          crm_finance_revision: string
          crm_knowledge_enabled: boolean
          crm_knowledge_read_revision: string
          crm_move_authorized_phone: string
          crm_move_enabled: boolean
          crm_move_instance: string
          crm_move_phone: string
          crm_move_revision: string
          crm_read_enabled: boolean
          crm_read_instance: string
          crm_read_phone: string
          crm_read_revision: string
          enabled: boolean
          id: number
          updated_at: string
        }
        Insert: {
          authorized_phone?: string
          crm_finance_authorized_phone?: string
          crm_finance_enabled?: boolean
          crm_finance_instance?: string
          crm_finance_phone?: string
          crm_finance_read_revision?: string
          crm_finance_revision?: string
          crm_knowledge_enabled?: boolean
          crm_knowledge_read_revision?: string
          crm_move_authorized_phone?: string
          crm_move_enabled?: boolean
          crm_move_instance?: string
          crm_move_phone?: string
          crm_move_revision?: string
          crm_read_enabled?: boolean
          crm_read_instance?: string
          crm_read_phone?: string
          crm_read_revision?: string
          enabled?: boolean
          id?: number
          updated_at?: string
        }
        Update: {
          authorized_phone?: string
          crm_finance_authorized_phone?: string
          crm_finance_enabled?: boolean
          crm_finance_instance?: string
          crm_finance_phone?: string
          crm_finance_read_revision?: string
          crm_finance_revision?: string
          crm_knowledge_enabled?: boolean
          crm_knowledge_read_revision?: string
          crm_move_authorized_phone?: string
          crm_move_enabled?: boolean
          crm_move_instance?: string
          crm_move_phone?: string
          crm_move_revision?: string
          crm_read_enabled?: boolean
          crm_read_instance?: string
          crm_read_phone?: string
          crm_read_revision?: string
          enabled?: boolean
          id?: number
          updated_at?: string
        }
        Relationships: []
      }
      gravon_lead_stage_actions: {
        Row: {
          code: string
          company: string
          completed_at: string | null
          confirmation_id: string | null
          created_at: string
          expected_change_revision: number
          expected_updated_at: string
          expires_at: string
          id: string
          inbound_id: string
          instance: string
          lead_id: string
          lead_name: string
          move_revision: string
          phone: string
          read_revision: string
          remote_jid: string
          source_stage: string
          status: string
          target_stage: string
        }
        Insert: {
          code?: string
          company: string
          completed_at?: string | null
          confirmation_id?: string | null
          created_at?: string
          expected_change_revision?: number
          expected_updated_at: string
          expires_at?: string
          id?: string
          inbound_id: string
          instance: string
          lead_id: string
          lead_name: string
          move_revision: string
          phone: string
          read_revision: string
          remote_jid: string
          source_stage: string
          status?: string
          target_stage: string
        }
        Update: {
          code?: string
          company?: string
          completed_at?: string | null
          confirmation_id?: string | null
          created_at?: string
          expected_change_revision?: number
          expected_updated_at?: string
          expires_at?: string
          id?: string
          inbound_id?: string
          instance?: string
          lead_id?: string
          lead_name?: string
          move_revision?: string
          phone?: string
          read_revision?: string
          remote_jid?: string
          source_stage?: string
          status?: string
          target_stage?: string
        }
        Relationships: []
      }
      gravon_move_confirmations: {
        Row: {
          cancel: boolean
          created_at: string
          inbound_id: string
          instance: string
          move_revision: string
          phone: string
          read_revision: string
          result: Json
        }
        Insert: {
          cancel: boolean
          created_at?: string
          inbound_id: string
          instance: string
          move_revision: string
          phone: string
          read_revision: string
          result: Json
        }
        Update: {
          cancel?: boolean
          created_at?: string
          inbound_id?: string
          instance?: string
          move_revision?: string
          phone?: string
          read_revision?: string
          result?: Json
        }
        Relationships: []
      }
      gravon_outbound_reservations: {
        Row: {
          body: string
          created_at: string
          echo_id: string | null
          id: string
          inbound_id: string
          instance: string
          provider_id: string | null
          remote_jid: string
          state: string
        }
        Insert: {
          body: string
          created_at?: string
          echo_id?: string | null
          id?: string
          inbound_id: string
          instance: string
          provider_id?: string | null
          remote_jid: string
          state?: string
        }
        Update: {
          body?: string
          created_at?: string
          echo_id?: string | null
          id?: string
          inbound_id?: string
          instance?: string
          provider_id?: string | null
          remote_jid?: string
          state?: string
        }
        Relationships: []
      }
      instagram_accounts: {
        Row: {
          app_secret_name: string
          checked_at: string | null
          company_key: string
          enabled: boolean
          error_code: string | null
          greeting: string
          greeting_enabled: boolean
          id: string
          instagram_id: string
          last_event_at: string | null
          subscribed_at: string | null
          token_secret_name: string
          updated_at: string
          updated_by: string
          username: string
        }
        Insert: {
          app_secret_name: string
          checked_at?: string | null
          company_key: string
          enabled?: boolean
          error_code?: string | null
          greeting?: string
          greeting_enabled?: boolean
          id?: string
          instagram_id: string
          last_event_at?: string | null
          subscribed_at?: string | null
          token_secret_name: string
          updated_at?: string
          updated_by: string
          username: string
        }
        Update: {
          app_secret_name?: string
          checked_at?: string | null
          company_key?: string
          enabled?: boolean
          error_code?: string | null
          greeting?: string
          greeting_enabled?: boolean
          id?: string
          instagram_id?: string
          last_event_at?: string | null
          subscribed_at?: string | null
          token_secret_name?: string
          updated_at?: string
          updated_by?: string
          username?: string
        }
        Relationships: []
      }
      instagram_contacts: {
        Row: {
          account_id: string
          company_key: string
          created_at: string
          greeting_at: string | null
          greeting_provider_id: string | null
          greeting_state: string
          greeting_text: string | null
          id: string
          last_inbound_at: string
          origin: string
          sender_id: string
        }
        Insert: {
          account_id: string
          company_key: string
          created_at?: string
          greeting_at?: string | null
          greeting_provider_id?: string | null
          greeting_state?: string
          greeting_text?: string | null
          id?: string
          last_inbound_at: string
          origin?: string
          sender_id: string
        }
        Update: {
          account_id?: string
          company_key?: string
          created_at?: string
          greeting_at?: string | null
          greeting_provider_id?: string | null
          greeting_state?: string
          greeting_text?: string | null
          id?: string
          last_inbound_at?: string
          origin?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "instagram_contacts_company_key_account_id_fkey"
            columns: ["company_key", "account_id"]
            isOneToOne: false
            referencedRelation: "instagram_accounts"
            referencedColumns: ["company_key", "id"]
          },
        ]
      }
      instagram_messages: {
        Row: {
          account_id: string
          body: string | null
          company_key: string
          contact_id: string
          from_me: boolean
          id: string
          kind: string
          message_id: string
          received_at: string
          send_state: string | null
          sent_at: string
        }
        Insert: {
          account_id: string
          body?: string | null
          company_key: string
          contact_id: string
          from_me: boolean
          id?: string
          kind: string
          message_id: string
          received_at?: string
          send_state?: string | null
          sent_at: string
        }
        Update: {
          account_id?: string
          body?: string | null
          company_key?: string
          contact_id?: string
          from_me?: boolean
          id?: string
          kind?: string
          message_id?: string
          received_at?: string
          send_state?: string | null
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "instagram_messages_company_key_account_id_contact_id_fkey"
            columns: ["company_key", "account_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "instagram_contacts"
            referencedColumns: ["company_key", "account_id", "id"]
          },
        ]
      }
      instagram_oauth_candidates: {
        Row: {
          account_id: string
          app_id: string
          author_id: string
          company_key: string
          created_at: string
          encrypted_token: string
          expires_at: string
          instagram_id: string
          verified_scopes: string[]
        }
        Insert: {
          account_id: string
          app_id: string
          author_id: string
          company_key: string
          created_at?: string
          encrypted_token: string
          expires_at: string
          instagram_id: string
          verified_scopes: string[]
        }
        Update: {
          account_id?: string
          app_id?: string
          author_id?: string
          company_key?: string
          created_at?: string
          encrypted_token?: string
          expires_at?: string
          instagram_id?: string
          verified_scopes?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "instagram_oauth_candidates_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "instagram_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instagram_oauth_candidates_company_key_account_id_fkey"
            columns: ["company_key", "account_id"]
            isOneToOne: false
            referencedRelation: "instagram_accounts"
            referencedColumns: ["company_key", "id"]
          },
        ]
      }
      instagram_oauth_credentials: {
        Row: {
          account_id: string
          company_key: string
          encrypted_token: string
          expires_at: string
          updated_at: string
        }
        Insert: {
          account_id: string
          company_key: string
          encrypted_token: string
          expires_at: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          company_key?: string
          encrypted_token?: string
          expires_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "instagram_oauth_credentials_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "instagram_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instagram_oauth_credentials_company_key_account_id_fkey"
            columns: ["company_key", "account_id"]
            isOneToOne: false
            referencedRelation: "instagram_accounts"
            referencedColumns: ["company_key", "id"]
          },
        ]
      }
      instagram_oauth_flows: {
        Row: {
          account_id: string | null
          app_id: string | null
          author_id: string
          binding_hash: string
          callback_received_at: string | null
          company_key: string
          created_at: string
          diagnostic_code: string | null
          diagnostic_http_status: number | null
          diagnostic_stage: string | null
          encrypted_token: string | null
          expires_at: string
          instagram_id: string | null
          state_hash: string
          status: string
          token_expires_at: string | null
          username: string | null
          verified_scopes: string[] | null
        }
        Insert: {
          account_id?: string | null
          app_id?: string | null
          author_id: string
          binding_hash: string
          callback_received_at?: string | null
          company_key: string
          created_at?: string
          diagnostic_code?: string | null
          diagnostic_http_status?: number | null
          diagnostic_stage?: string | null
          encrypted_token?: string | null
          expires_at: string
          instagram_id?: string | null
          state_hash: string
          status?: string
          token_expires_at?: string | null
          username?: string | null
          verified_scopes?: string[] | null
        }
        Update: {
          account_id?: string | null
          app_id?: string | null
          author_id?: string
          binding_hash?: string
          callback_received_at?: string | null
          company_key?: string
          created_at?: string
          diagnostic_code?: string | null
          diagnostic_http_status?: number | null
          diagnostic_stage?: string | null
          encrypted_token?: string | null
          expires_at?: string
          instagram_id?: string | null
          state_hash?: string
          status?: string
          token_expires_at?: string | null
          username?: string | null
          verified_scopes?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "instagram_oauth_flows_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "instagram_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_ai_qualification_runner: {
        Row: {
          ai_blocked_reason: string
          enabled: boolean
          id: boolean
          job_url: string
          last_result: Json
          last_run_at: string | null
          token: string
        }
        Insert: {
          ai_blocked_reason?: string
          enabled?: boolean
          id?: boolean
          job_url?: string
          last_result?: Json
          last_run_at?: string | null
          token?: string
        }
        Update: {
          ai_blocked_reason?: string
          enabled?: boolean
          id?: boolean
          job_url?: string
          last_result?: Json
          last_run_at?: string | null
          token?: string
        }
        Relationships: []
      }
      lead_ai_qualifications: {
        Row: {
          assessed_at: string | null
          attempts: number
          created_at: string
          entered_stage_at: string
          evidence: Json
          fingerprint: string | null
          fit_reason: string
          last_error: string
          last_inbound_at: string | null
          lead_id: string
          lease_token: string | null
          lease_until: string | null
          next_check_at: string
          qualified_at: string | null
          state: string
          status: string
          summary: string
          updated_at: string
        }
        Insert: {
          assessed_at?: string | null
          attempts?: number
          created_at?: string
          entered_stage_at?: string
          evidence?: Json
          fingerprint?: string | null
          fit_reason?: string
          last_error?: string
          last_inbound_at?: string | null
          lead_id: string
          lease_token?: string | null
          lease_until?: string | null
          next_check_at?: string
          qualified_at?: string | null
          state?: string
          status?: string
          summary?: string
          updated_at?: string
        }
        Update: {
          assessed_at?: string | null
          attempts?: number
          created_at?: string
          entered_stage_at?: string
          evidence?: Json
          fingerprint?: string | null
          fit_reason?: string
          last_error?: string
          last_inbound_at?: string | null
          lead_id?: string
          lease_token?: string | null
          lease_until?: string | null
          next_check_at?: string
          qualified_at?: string | null
          state?: string
          status?: string
          summary?: string
          updated_at?: string
        }
        Relationships: []
      }
      lead_deskdata_bindings: {
        Row: {
          cnpj: string
          identity_confirmed_at: string
          lead_id: string
          storage_authorized_at: string
        }
        Insert: {
          cnpj: string
          identity_confirmed_at?: string
          lead_id: string
          storage_authorized_at?: string
        }
        Update: {
          cnpj?: string
          identity_confirmed_at?: string
          lead_id?: string
          storage_authorized_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_deskdata_bindings_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_deskdata_history: {
        Row: {
          checked_at: string
          cnpj: string
          created_at: string
          datasets: Json
          estimated_credits: number
          id: string
          lead_id: string
          outcome_code: string | null
          profile: Json | null
          query_key: string
          status: string
        }
        Insert: {
          checked_at?: string
          cnpj: string
          created_at?: string
          datasets: Json
          estimated_credits: number
          id?: string
          lead_id: string
          outcome_code?: string | null
          profile?: Json | null
          query_key: string
          status?: string
        }
        Update: {
          checked_at?: string
          cnpj?: string
          created_at?: string
          datasets?: Json
          estimated_credits?: number
          id?: string
          lead_id?: string
          outcome_code?: string | null
          profile?: Json | null
          query_key?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_deskdata_history_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_deskdata_history_query_key_fkey"
            columns: ["query_key"]
            isOneToOne: false
            referencedRelation: "b2b_lookup_cache"
            referencedColumns: ["query_key"]
          },
        ]
      }
      leads: {
        Row: {
          closed_at: string | null
          closed_value: number | null
          closed_value_confirmed_at: string | null
          company: string
          created_at: string
          email: string
          employees: string
          entry_date: string
          first_contact_consent_at: string | null
          first_contact_consent_version: string | null
          first_contact_first_name: string | null
          first_contact_form_origin: string | null
          first_contact_phone: string | null
          first_contact_submission_id: string | null
          gravon_change_revision: number
          history: Json
          id: string
          instagram: string
          invested_traffic: string
          last_conversation: string
          name: string
          next_action: string
          next_action_date: string | null
          next_steps: string
          notes: string
          owner: string
          pipeline_id: string | null
          potential_value: number
          revenue: string
          service: string
          source: string
          stage: string
          status: string
          tags: Json
          updated_at: string
          utm_campaign: string
          utm_content: string
          utm_medium: string
          utm_source: string
          utm_term: string
          website: string
          whatsapp: string
        }
        Insert: {
          closed_at?: string | null
          closed_value?: number | null
          closed_value_confirmed_at?: string | null
          company?: string
          created_at?: string
          email?: string
          employees?: string
          entry_date?: string
          first_contact_consent_at?: string | null
          first_contact_consent_version?: string | null
          first_contact_first_name?: string | null
          first_contact_form_origin?: string | null
          first_contact_phone?: string | null
          first_contact_submission_id?: string | null
          gravon_change_revision?: number
          history?: Json
          id?: string
          instagram?: string
          invested_traffic?: string
          last_conversation?: string
          name?: string
          next_action?: string
          next_action_date?: string | null
          next_steps?: string
          notes?: string
          owner?: string
          pipeline_id?: string | null
          potential_value?: number
          revenue?: string
          service?: string
          source?: string
          stage?: string
          status?: string
          tags?: Json
          updated_at?: string
          utm_campaign?: string
          utm_content?: string
          utm_medium?: string
          utm_source?: string
          utm_term?: string
          website?: string
          whatsapp?: string
        }
        Update: {
          closed_at?: string | null
          closed_value?: number | null
          closed_value_confirmed_at?: string | null
          company?: string
          created_at?: string
          email?: string
          employees?: string
          entry_date?: string
          first_contact_consent_at?: string | null
          first_contact_consent_version?: string | null
          first_contact_first_name?: string | null
          first_contact_form_origin?: string | null
          first_contact_phone?: string | null
          first_contact_submission_id?: string | null
          gravon_change_revision?: number
          history?: Json
          id?: string
          instagram?: string
          invested_traffic?: string
          last_conversation?: string
          name?: string
          next_action?: string
          next_action_date?: string | null
          next_steps?: string
          notes?: string
          owner?: string
          pipeline_id?: string | null
          potential_value?: number
          revenue?: string
          service?: string
          source?: string
          stage?: string
          status?: string
          tags?: Json
          updated_at?: string
          utm_campaign?: string
          utm_content?: string
          utm_medium?: string
          utm_source?: string
          utm_term?: string
          website?: string
          whatsapp?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "sales_pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_event_mappings: {
        Row: {
          active: boolean
          company_key: string
          created_at: string
          crm_stage: string
          google_action: string
          id: string
          meta_event: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          company_key?: string
          created_at?: string
          crm_stage: string
          google_action?: string
          id?: string
          meta_event?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          company_key?: string
          created_at?: string
          crm_stage?: string
          google_action?: string
          id?: string
          meta_event?: string
          updated_at?: string
        }
        Relationships: []
      }
      marketing_integrations: {
        Row: {
          account_id: string
          account_name: string
          active: boolean
          company_key: string
          created_at: string
          id: string
          platform: string
          updated_at: string
        }
        Insert: {
          account_id: string
          account_name?: string
          active?: boolean
          company_key?: string
          created_at?: string
          id?: string
          platform: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          account_name?: string
          active?: boolean
          company_key?: string
          created_at?: string
          id?: string
          platform?: string
          updated_at?: string
        }
        Relationships: []
      }
      meta_ads_spend_accounts: {
        Row: {
          account_name: string
          active: boolean
          ad_account_id: string
          client_id: string | null
          created_at: string
          created_by: string
          currency: string
          id: string
          last_sync_at: string | null
          last_sync_code: string | null
          last_sync_status: string | null
          last_test_at: string | null
          last_test_code: string | null
          last_test_ok: boolean | null
          owner_kind: string
          revision: number
          sync_enabled: boolean
          synced_from: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          account_name?: string
          active?: boolean
          ad_account_id: string
          client_id?: string | null
          created_at?: string
          created_by?: string
          currency?: string
          id?: string
          last_sync_at?: string | null
          last_sync_code?: string | null
          last_sync_status?: string | null
          last_test_at?: string | null
          last_test_code?: string | null
          last_test_ok?: boolean | null
          owner_kind: string
          revision?: number
          sync_enabled?: boolean
          synced_from?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          account_name?: string
          active?: boolean
          ad_account_id?: string
          client_id?: string | null
          created_at?: string
          created_by?: string
          currency?: string
          id?: string
          last_sync_at?: string | null
          last_sync_code?: string | null
          last_sync_status?: string | null
          last_test_at?: string | null
          last_test_code?: string | null
          last_test_ok?: boolean | null
          owner_kind?: string
          revision?: number
          sync_enabled?: boolean
          synced_from?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_ads_spend_accounts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_ads_spend_daily: {
        Row: {
          ad_account_id: string
          adset_id: string
          adset_name: string
          campaign_id: string
          campaign_name: string
          currency: string
          spend_cents: number
          spend_date: string
          synced_at: string
        }
        Insert: {
          ad_account_id: string
          adset_id: string
          adset_name?: string
          campaign_id: string
          campaign_name?: string
          currency: string
          spend_cents: number
          spend_date: string
          synced_at?: string
        }
        Update: {
          ad_account_id?: string
          adset_id?: string
          adset_name?: string
          campaign_id?: string
          campaign_name?: string
          currency?: string
          spend_cents?: number
          spend_date?: string
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_ads_spend_daily_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "meta_ads_spend_accounts"
            referencedColumns: ["ad_account_id"]
          },
        ]
      }
      meta_ads_spend_runner: {
        Row: {
          id: boolean
          last_result: Json
          last_run_at: string | null
          token: string
        }
        Insert: {
          id?: boolean
          last_result?: Json
          last_run_at?: string | null
          token?: string
        }
        Update: {
          id?: boolean
          last_result?: Json
          last_run_at?: string | null
          token?: string
        }
        Relationships: []
      }
      meta_capi_event_attempts: {
        Row: {
          attempt_no: number
          code: string | null
          company_key: string
          created_at: string
          event_row: string
          http: number | null
          id: string
          outcome: string
          request_summary: Json
          response_summary: Json
          trigger: string
        }
        Insert: {
          attempt_no: number
          code?: string | null
          company_key: string
          created_at?: string
          event_row: string
          http?: number | null
          id?: string
          outcome: string
          request_summary?: Json
          response_summary?: Json
          trigger: string
        }
        Update: {
          attempt_no?: number
          code?: string | null
          company_key?: string
          created_at?: string
          event_row?: string
          http?: number | null
          id?: string
          outcome?: string
          request_summary?: Json
          response_summary?: Json
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_capi_event_attempts_event_row_fkey"
            columns: ["event_row"]
            isOneToOne: false
            referencedRelation: "meta_capi_lead_events"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_capi_lead_events: {
        Row: {
          attempts: number
          company_key: string
          created_at: string
          event_id: string
          event_name: string
          event_time: string
          id: string
          last_attempt_at: string | null
          last_code: string | null
          last_http: number | null
          lead_id: string
          next_attempt_at: string | null
          pixel_id: string | null
          retryable: boolean
          sent_at: string | null
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          company_key: string
          created_at?: string
          event_id: string
          event_name: string
          event_time: string
          id?: string
          last_attempt_at?: string | null
          last_code?: string | null
          last_http?: number | null
          lead_id: string
          next_attempt_at?: string | null
          pixel_id?: string | null
          retryable?: boolean
          sent_at?: string | null
          source?: string
          status: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          company_key?: string
          created_at?: string
          event_id?: string
          event_name?: string
          event_time?: string
          id?: string
          last_attempt_at?: string | null
          last_code?: string | null
          last_http?: number | null
          lead_id?: string
          next_attempt_at?: string | null
          pixel_id?: string | null
          retryable?: boolean
          sent_at?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      meta_capi_settings: {
        Row: {
          company_key: string
          created_at: string
          enabled: boolean
          encrypted_token: string
          last_check_at: string | null
          last_check_code: string | null
          last_check_http: number | null
          last_check_status: string | null
          last_test_event_at: string | null
          last_test_event_http: number | null
          last_test_event_status: string | null
          pixel_id: string
          pixel_name: string | null
          production_enabled: boolean
          revision: number
          updated_at: string
          updated_by: string
        }
        Insert: {
          company_key: string
          created_at?: string
          enabled?: boolean
          encrypted_token: string
          last_check_at?: string | null
          last_check_code?: string | null
          last_check_http?: number | null
          last_check_status?: string | null
          last_test_event_at?: string | null
          last_test_event_http?: number | null
          last_test_event_status?: string | null
          pixel_id: string
          pixel_name?: string | null
          production_enabled?: boolean
          revision?: number
          updated_at?: string
          updated_by: string
        }
        Update: {
          company_key?: string
          created_at?: string
          enabled?: boolean
          encrypted_token?: string
          last_check_at?: string | null
          last_check_code?: string | null
          last_check_http?: number | null
          last_check_status?: string | null
          last_test_event_at?: string | null
          last_test_event_http?: number | null
          last_test_event_status?: string | null
          pixel_id?: string
          pixel_name?: string | null
          production_enabled?: boolean
          revision?: number
          updated_at?: string
          updated_by?: string
        }
        Relationships: []
      }
      meta_instagram_research_settings: {
        Row: {
          company_key: string
          created_at: string
          encrypted_token: string
          ig_user_id: string
          ig_username: string | null
          last_check_at: string | null
          last_check_code: string | null
          last_check_http: number | null
          last_check_status: string | null
          revision: number
          updated_at: string
          updated_by: string
        }
        Insert: {
          company_key: string
          created_at?: string
          encrypted_token: string
          ig_user_id: string
          ig_username?: string | null
          last_check_at?: string | null
          last_check_code?: string | null
          last_check_http?: number | null
          last_check_status?: string | null
          revision?: number
          updated_at?: string
          updated_by: string
        }
        Update: {
          company_key?: string
          created_at?: string
          encrypted_token?: string
          ig_user_id?: string
          ig_username?: string | null
          last_check_at?: string | null
          last_check_code?: string | null
          last_check_http?: number | null
          last_check_status?: string | null
          revision?: number
          updated_at?: string
          updated_by?: string
        }
        Relationships: []
      }
      polp_bank_accounts: {
        Row: {
          account_subtype: string | null
          account_type: string | null
          company_key: string
          consent_id: string
          currency: string | null
          first_seen_at: string
          last_seen_at: string
          number_suffix: string | null
          polp_account_id: string
        }
        Insert: {
          account_subtype?: string | null
          account_type?: string | null
          company_key: string
          consent_id: string
          currency?: string | null
          first_seen_at?: string
          last_seen_at?: string
          number_suffix?: string | null
          polp_account_id: string
        }
        Update: {
          account_subtype?: string | null
          account_type?: string | null
          company_key?: string
          consent_id?: string
          currency?: string | null
          first_seen_at?: string
          last_seen_at?: string
          number_suffix?: string | null
          polp_account_id?: string
        }
        Relationships: []
      }
      polp_bank_ai_suggestions: {
        Row: {
          category: string | null
          company_key: string
          confidence: string
          created_at: string
          kind: string
          model: string
          polp_transaction_id: string
          reason: string | null
        }
        Insert: {
          category?: string | null
          company_key: string
          confidence: string
          created_at?: string
          kind: string
          model: string
          polp_transaction_id: string
          reason?: string | null
        }
        Update: {
          category?: string | null
          company_key?: string
          confidence?: string
          created_at?: string
          kind?: string
          model?: string
          polp_transaction_id?: string
          reason?: string | null
        }
        Relationships: []
      }
      polp_bank_balance_snapshots: {
        Row: {
          available_cents: number | null
          bank_updated_at: string
          blocked_cents: number | null
          captured_at: string
          company_key: string
          currency: string | null
          id: string
          invested_cents: number | null
          polp_account_id: string
        }
        Insert: {
          available_cents?: number | null
          bank_updated_at: string
          blocked_cents?: number | null
          captured_at?: string
          company_key: string
          currency?: string | null
          id?: string
          invested_cents?: number | null
          polp_account_id: string
        }
        Update: {
          available_cents?: number | null
          bank_updated_at?: string
          blocked_cents?: number | null
          captured_at?: string
          company_key?: string
          currency?: string | null
          id?: string
          invested_cents?: number | null
          polp_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "polp_bank_balance_snapshots_company_key_polp_account_id_fkey"
            columns: ["company_key", "polp_account_id"]
            isOneToOne: false
            referencedRelation: "polp_bank_accounts"
            referencedColumns: ["company_key", "polp_account_id"]
          },
        ]
      }
      polp_bank_classification_audit: {
        Row: {
          actor: string
          after_data: Json
          before_data: Json | null
          company_key: string
          created_at: string
          id: string
          polp_transaction_id: string
          rule_id: string | null
        }
        Insert: {
          actor: string
          after_data: Json
          before_data?: Json | null
          company_key: string
          created_at?: string
          id?: string
          polp_transaction_id: string
          rule_id?: string | null
        }
        Update: {
          actor?: string
          after_data?: Json
          before_data?: Json | null
          company_key?: string
          created_at?: string
          id?: string
          polp_transaction_id?: string
          rule_id?: string | null
        }
        Relationships: []
      }
      polp_bank_classification_overrides: {
        Row: {
          category: string | null
          company_key: string
          decision: string
          kind: string
          polp_transaction_id: string
          revision: number
          updated_at: string
          updated_by: string
          vendor: string | null
        }
        Insert: {
          category?: string | null
          company_key: string
          decision?: string
          kind: string
          polp_transaction_id: string
          revision?: number
          updated_at?: string
          updated_by: string
          vendor?: string | null
        }
        Update: {
          category?: string | null
          company_key?: string
          decision?: string
          kind?: string
          polp_transaction_id?: string
          revision?: number
          updated_at?: string
          updated_by?: string
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "polp_bank_classification_over_company_key_polp_transaction_fkey"
            columns: ["company_key", "polp_transaction_id"]
            isOneToOne: true
            referencedRelation: "polp_bank_transactions"
            referencedColumns: ["company_key", "polp_transaction_id"]
          },
        ]
      }
      polp_bank_classification_rules: {
        Row: {
          active: boolean
          category: string | null
          company_key: string
          created_at: string
          created_by: string
          created_from: string | null
          direction: string
          field: string
          id: string
          kind: string
          pattern: string
          updated_at: string
          vendor: string | null
        }
        Insert: {
          active?: boolean
          category?: string | null
          company_key: string
          created_at?: string
          created_by: string
          created_from?: string | null
          direction?: string
          field: string
          id?: string
          kind: string
          pattern: string
          updated_at?: string
          vendor?: string | null
        }
        Update: {
          active?: boolean
          category?: string | null
          company_key?: string
          created_at?: string
          created_by?: string
          created_from?: string | null
          direction?: string
          field?: string
          id?: string
          kind?: string
          pattern?: string
          updated_at?: string
          vendor?: string | null
        }
        Relationships: []
      }
      polp_bank_client_links: {
        Row: {
          actor: string
          client_id: string
          company_key: string
          created_at: string
          polp_transaction_id: string
        }
        Insert: {
          actor: string
          client_id: string
          company_key: string
          created_at?: string
          polp_transaction_id: string
        }
        Update: {
          actor?: string
          client_id?: string
          company_key?: string
          created_at?: string
          polp_transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "polp_bank_client_links_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "polp_bank_client_links_company_key_polp_transaction_id_fkey"
            columns: ["company_key", "polp_transaction_id"]
            isOneToOne: true
            referencedRelation: "polp_bank_transactions"
            referencedColumns: ["company_key", "polp_transaction_id"]
          },
        ]
      }
      polp_bank_reconciliations: {
        Row: {
          actor: string
          amount_cents: number
          charge_id: string | null
          client_payment_id: string | null
          company_key: string
          created_at: string
          finance_settlement_id: string | null
          mode: string
          operation: string
          polp_transaction_id: string
          target_type: string
        }
        Insert: {
          actor: string
          amount_cents: number
          charge_id?: string | null
          client_payment_id?: string | null
          company_key: string
          created_at?: string
          finance_settlement_id?: string | null
          mode: string
          operation: string
          polp_transaction_id: string
          target_type: string
        }
        Update: {
          actor?: string
          amount_cents?: number
          charge_id?: string | null
          client_payment_id?: string | null
          company_key?: string
          created_at?: string
          finance_settlement_id?: string | null
          mode?: string
          operation?: string
          polp_transaction_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "polp_bank_reconciliations_client_payment_id_fkey"
            columns: ["client_payment_id"]
            isOneToOne: true
            referencedRelation: "crm_client_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "polp_bank_reconciliations_company_key_polp_transaction_id_fkey"
            columns: ["company_key", "polp_transaction_id"]
            isOneToOne: true
            referencedRelation: "polp_bank_transactions"
            referencedColumns: ["company_key", "polp_transaction_id"]
          },
          {
            foreignKeyName: "polp_bank_reconciliations_finance_settlement_id_fkey"
            columns: ["finance_settlement_id"]
            isOneToOne: true
            referencedRelation: "finance_records"
            referencedColumns: ["id"]
          },
        ]
      }
      polp_bank_review_operations: {
        Row: {
          actor: string
          company_key: string
          created_at: string
          operation: string
          payload: Json
          saved: number
        }
        Insert: {
          actor: string
          company_key: string
          created_at?: string
          operation: string
          payload: Json
          saved: number
        }
        Update: {
          actor?: string
          company_key?: string
          created_at?: string
          operation?: string
          payload?: Json
          saved?: number
        }
        Relationships: []
      }
      polp_bank_transaction_versions: {
        Row: {
          company_key: string
          content_hash: string
          id: string
          recorded_at: string
          revision: number
          snapshot: Json
          sync_run: string | null
          transaction_id: string
        }
        Insert: {
          company_key: string
          content_hash: string
          id?: string
          recorded_at?: string
          revision: number
          snapshot: Json
          sync_run?: string | null
          transaction_id: string
        }
        Update: {
          company_key?: string
          content_hash?: string
          id?: string
          recorded_at?: string
          revision?: number
          snapshot?: Json
          sync_run?: string | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "polp_bank_transaction_versions_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "polp_bank_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      polp_bank_transactions: {
        Row: {
          amount_cents: number | null
          amount_raw: string
          category_ref: string | null
          company_key: string
          consent_id: string
          content_hash: string
          counterparty_doc_hmac: string | null
          counterparty_doc_kind: string | null
          counterparty_key_version: number | null
          counterparty_name: string | null
          counterparty_person_type: string | null
          currency: string
          description: string | null
          direction: string | null
          first_seen_at: string
          id: string
          last_seen_at: string
          last_sync_run: string | null
          polp_account_id: string
          polp_transaction_id: string
          provider_created_at: string | null
          provider_updated_at: string | null
          revision: number
          transaction_at: string | null
          transaction_type: string | null
        }
        Insert: {
          amount_cents?: number | null
          amount_raw: string
          category_ref?: string | null
          company_key: string
          consent_id: string
          content_hash: string
          counterparty_doc_hmac?: string | null
          counterparty_doc_kind?: string | null
          counterparty_key_version?: number | null
          counterparty_name?: string | null
          counterparty_person_type?: string | null
          currency: string
          description?: string | null
          direction?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          last_sync_run?: string | null
          polp_account_id: string
          polp_transaction_id: string
          provider_created_at?: string | null
          provider_updated_at?: string | null
          revision?: number
          transaction_at?: string | null
          transaction_type?: string | null
        }
        Update: {
          amount_cents?: number | null
          amount_raw?: string
          category_ref?: string | null
          company_key?: string
          consent_id?: string
          content_hash?: string
          counterparty_doc_hmac?: string | null
          counterparty_doc_kind?: string | null
          counterparty_key_version?: number | null
          counterparty_name?: string | null
          counterparty_person_type?: string | null
          currency?: string
          description?: string | null
          direction?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          last_sync_run?: string | null
          polp_account_id?: string
          polp_transaction_id?: string
          provider_created_at?: string | null
          provider_updated_at?: string | null
          revision?: number
          transaction_at?: string | null
          transaction_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "polp_bank_transactions_company_key_polp_account_id_fkey"
            columns: ["company_key", "polp_account_id"]
            isOneToOne: false
            referencedRelation: "polp_bank_accounts"
            referencedColumns: ["company_key", "polp_account_id"]
          },
        ]
      }
      polp_consents: {
        Row: {
          consent_id: string
          created_at: string
          execution_status: string | null
          id: string
          institution_id: string
          institution_name: string
          last_checked_at: string
          products: Json
          renewal_lease_id: string | null
          renewal_lease_until: string | null
          status: string
          updated_at: string
          url_expires_at: string | null
        }
        Insert: {
          consent_id: string
          created_at?: string
          execution_status?: string | null
          id?: string
          institution_id: string
          institution_name?: string
          last_checked_at?: string
          products?: Json
          renewal_lease_id?: string | null
          renewal_lease_until?: string | null
          status: string
          updated_at?: string
          url_expires_at?: string | null
        }
        Update: {
          consent_id?: string
          created_at?: string
          execution_status?: string | null
          id?: string
          institution_id?: string
          institution_name?: string
          last_checked_at?: string
          products?: Json
          renewal_lease_id?: string | null
          renewal_lease_until?: string | null
          status?: string
          updated_at?: string
          url_expires_at?: string | null
        }
        Relationships: []
      }
      polp_sync_runs: {
        Row: {
          accounts_seen: number
          company_key: string
          consent_id: string
          error_code: string | null
          finished_at: string | null
          id: string
          inserted: number
          mode: string
          skipped: number
          started_at: string
          status: string
          trigger: string
          unchanged: number
          updated: number
          window_from: string
          window_to: string
        }
        Insert: {
          accounts_seen?: number
          company_key: string
          consent_id: string
          error_code?: string | null
          finished_at?: string | null
          id: string
          inserted?: number
          mode: string
          skipped?: number
          started_at?: string
          status?: string
          trigger: string
          unchanged?: number
          updated?: number
          window_from: string
          window_to: string
        }
        Update: {
          accounts_seen?: number
          company_key?: string
          consent_id?: string
          error_code?: string | null
          finished_at?: string | null
          id?: string
          inserted?: number
          mode?: string
          skipped?: number
          started_at?: string
          status?: string
          trigger?: string
          unchanged?: number
          updated?: number
          window_from?: string
          window_to?: string
        }
        Relationships: []
      }
      polp_sync_state: {
        Row: {
          company_key: string
          consent_id: string
          last_success_at: string | null
          last_success_started_at: string | null
          lease_id: string | null
          lease_until: string | null
        }
        Insert: {
          company_key: string
          consent_id: string
          last_success_at?: string | null
          last_success_started_at?: string | null
          lease_id?: string | null
          lease_until?: string | null
        }
        Update: {
          company_key?: string
          consent_id?: string
          last_success_at?: string | null
          last_success_started_at?: string | null
          lease_id?: string | null
          lease_until?: string | null
        }
        Relationships: []
      }
      portal_admin_channels: {
        Row: {
          canonical_phone: string
          company_key: string
          granted_at: string
          granted_by: string
          id: string
          instance: string
          user_id: string
        }
        Insert: {
          canonical_phone: string
          company_key?: string
          granted_at?: string
          granted_by: string
          id?: string
          instance: string
          user_id: string
        }
        Update: {
          canonical_phone?: string
          company_key?: string
          granted_at?: string
          granted_by?: string
          id?: string
          instance?: string
          user_id?: string
        }
        Relationships: []
      }
      portal_ads_campaign_links: {
        Row: {
          account_id: string
          campaign_id: string
          company_key: string
          pipeline_key: string
          platform: string
          updated_at: string
        }
        Insert: {
          account_id: string
          campaign_id: string
          company_key?: string
          pipeline_key: string
          platform: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          campaign_id?: string
          company_key?: string
          pipeline_key?: string
          platform?: string
          updated_at?: string
        }
        Relationships: []
      }
      portal_ads_scheduler: {
        Row: {
          credential: string
          id: boolean
        }
        Insert: {
          credential: string
          id?: boolean
        }
        Update: {
          credential?: string
          id?: boolean
        }
        Relationships: []
      }
      portal_ads_snapshots: {
        Row: {
          attempted_at: string | null
          company_key: string
          error_code: string | null
          from_date: string
          lease_id: string | null
          lease_until: string | null
          payload: Json | null
          succeeded_at: string | null
          to_date: string
        }
        Insert: {
          attempted_at?: string | null
          company_key?: string
          error_code?: string | null
          from_date: string
          lease_id?: string | null
          lease_until?: string | null
          payload?: Json | null
          succeeded_at?: string | null
          to_date: string
        }
        Update: {
          attempted_at?: string | null
          company_key?: string
          error_code?: string | null
          from_date?: string
          lease_id?: string | null
          lease_until?: string | null
          payload?: Json | null
          succeeded_at?: string | null
          to_date?: string
        }
        Relationships: []
      }
      portal_whatsapp_notifications: {
        Row: {
          accepted_at: string | null
          art_version_id: string
          completed_at: string | null
          consent_at: string
          consent_evidence_id: string
          consent_policy_version: string
          created_at: string
          delivered_at: string | null
          fingerprint: string
          instance: string | null
          notification_id: string
          project_id: string
          provider_id: string | null
          recipient: string
          remote_jid: string | null
          request_id: string
          state: string
        }
        Insert: {
          accepted_at?: string | null
          art_version_id: string
          completed_at?: string | null
          consent_at: string
          consent_evidence_id: string
          consent_policy_version: string
          created_at?: string
          delivered_at?: string | null
          fingerprint: string
          instance?: string | null
          notification_id: string
          project_id: string
          provider_id?: string | null
          recipient: string
          remote_jid?: string | null
          request_id: string
          state?: string
        }
        Update: {
          accepted_at?: string | null
          art_version_id?: string
          completed_at?: string | null
          consent_at?: string
          consent_evidence_id?: string
          consent_policy_version?: string
          created_at?: string
          delivered_at?: string | null
          fingerprint?: string
          instance?: string | null
          notification_id?: string
          project_id?: string
          provider_id?: string | null
          recipient?: string
          remote_jid?: string | null
          request_id?: string
          state?: string
        }
        Relationships: []
      }
      sale_classifications: {
        Row: {
          classified_by: string
          closed_on: string
          company_key: string
          created_at: string
          customer_key: string
          first_acquisition: boolean
          id: string
          lead_id: string
          revision: number
          sale_type: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          classified_by: string
          closed_on: string
          company_key?: string
          created_at?: string
          customer_key: string
          first_acquisition: boolean
          id?: string
          lead_id: string
          revision?: number
          sale_type: string
          updated_at?: string
          updated_by: string
        }
        Update: {
          classified_by?: string
          closed_on?: string
          company_key?: string
          created_at?: string
          customer_key?: string
          first_acquisition?: boolean
          id?: string
          lead_id?: string
          revision?: number
          sale_type?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_classifications_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_pipelines: {
        Row: {
          archived: boolean
          created_at: string
          id: string
          name: string
          stages: Json
        }
        Insert: {
          archived?: boolean
          created_at?: string
          id?: string
          name: string
          stages: Json
        }
        Update: {
          archived?: boolean
          created_at?: string
          id?: string
          name?: string
          stages?: Json
        }
        Relationships: []
      }
      traffic_investments: {
        Row: {
          amount: number | null
          company_key: string
          created_at: string
          from_date: string
          id: string
          pipeline_key: string
          to_date: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          amount?: number | null
          company_key?: string
          created_at?: string
          from_date: string
          id?: string
          pipeline_key?: string
          to_date: string
          updated_at?: string
          updated_by?: string
        }
        Update: {
          amount?: number | null
          company_key?: string
          created_at?: string
          from_date?: string
          id?: string
          pipeline_key?: string
          to_date?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: []
      }
      universe_audit: {
        Row: {
          actor: string
          after_data: Json
          before_data: Json | null
          company_key: string
          created_at: string
          event: string
          id: string
          reason: string
          record_id: string | null
        }
        Insert: {
          actor: string
          after_data: Json
          before_data?: Json | null
          company_key?: string
          created_at?: string
          event: string
          id?: string
          reason: string
          record_id?: string | null
        }
        Update: {
          actor?: string
          after_data?: Json
          before_data?: Json | null
          company_key?: string
          created_at?: string
          event?: string
          id?: string
          reason?: string
          record_id?: string | null
        }
        Relationships: []
      }
      universe_awards: {
        Row: {
          amount: number
          awarded_at: string
          company_key: string
          evidence_total: number
          journey: string
          period: string
        }
        Insert: {
          amount: number
          awarded_at?: string
          company_key?: string
          evidence_total: number
          journey: string
          period: string
        }
        Update: {
          amount?: number
          awarded_at?: string
          company_key?: string
          evidence_total?: number
          journey?: string
          period?: string
        }
        Relationships: []
      }
      universe_receipts: {
        Row: {
          amount: number
          company_key: string
          created_at: string
          description: string
          id: string
          origin: string
          received_on: string
          reference: string
          revision: number
          status: string
        }
        Insert: {
          amount: number
          company_key?: string
          created_at?: string
          description: string
          id?: string
          origin: string
          received_on: string
          reference: string
          revision?: number
          status: string
        }
        Update: {
          amount?: number
          company_key?: string
          created_at?: string
          description?: string
          id?: string
          origin?: string
          received_on?: string
          reference?: string
          revision?: number
          status?: string
        }
        Relationships: []
      }
      universe_settings: {
        Row: {
          company_key: string
          lifetime: number[]
          monthly: number[]
          revision: number
        }
        Insert: {
          company_key: string
          lifetime: number[]
          monthly: number[]
          revision?: number
        }
        Update: {
          company_key?: string
          lifetime?: number[]
          monthly?: number[]
          revision?: number
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          granted_at: string
          granted_by: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_ai_control: {
        Row: {
          blocked_kind: string | null
          blocked_message: string | null
          blocked_status: number | null
          id: number
          updated_at: string
        }
        Insert: {
          blocked_kind?: string | null
          blocked_message?: string | null
          blocked_status?: number | null
          id: number
          updated_at?: string
        }
        Update: {
          blocked_kind?: string | null
          blocked_message?: string | null
          blocked_status?: number | null
          id?: number
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_analyses: {
        Row: {
          analyzed_at: string
          fingerprint: string
          id: string
          phone_key: string
          result: Json
          scope_end: string
          scope_start: string
        }
        Insert: {
          analyzed_at?: string
          fingerprint: string
          id?: string
          phone_key: string
          result: Json
          scope_end?: string
          scope_start?: string
        }
        Update: {
          analyzed_at?: string
          fingerprint?: string
          id?: string
          phone_key?: string
          result?: Json
          scope_end?: string
          scope_start?: string
        }
        Relationships: []
      }
      whatsapp_call_receipts: {
        Row: {
          call_id: string
          company_key: string
          contact_jid: string
          direction: string
          instance: string
          lead_id: string | null
          occurred_at: string | null
          received_at: string
          result: string
          state: string
        }
        Insert: {
          call_id: string
          company_key: string
          contact_jid?: string
          direction?: string
          instance: string
          lead_id?: string | null
          occurred_at?: string | null
          received_at?: string
          result?: string
          state?: string
        }
        Update: {
          call_id?: string
          company_key?: string
          contact_jid?: string
          direction?: string
          instance?: string
          lead_id?: string | null
          occurred_at?: string | null
          received_at?: string
          result?: string
          state?: string
        }
        Relationships: []
      }
      whatsapp_messages: {
        Row: {
          accepted_at: string | null
          agent_run_id: string | null
          analysis_draft_id: string | null
          approved_at: string | null
          approved_by: string | null
          body: string
          created_at: string
          delivered_at: string | null
          from_me: boolean
          id: string
          instance: string
          media_type: string
          message_id: string
          message_source: string | null
          phone: string
          phone_key: string
          push_name: string
          read_at: string | null
          remote_jid: string | null
          send_state: string | null
          sent_at: string
        }
        Insert: {
          accepted_at?: string | null
          agent_run_id?: string | null
          analysis_draft_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          body?: string
          created_at?: string
          delivered_at?: string | null
          from_me?: boolean
          id?: string
          instance?: string
          media_type?: string
          message_id: string
          message_source?: string | null
          phone?: string
          phone_key?: string
          push_name?: string
          read_at?: string | null
          remote_jid?: string | null
          send_state?: string | null
          sent_at?: string
        }
        Update: {
          accepted_at?: string | null
          agent_run_id?: string | null
          analysis_draft_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          body?: string
          created_at?: string
          delivered_at?: string | null
          from_me?: boolean
          id?: string
          instance?: string
          media_type?: string
          message_id?: string
          message_source?: string | null
          phone?: string
          phone_key?: string
          push_name?: string
          read_at?: string | null
          remote_jid?: string | null
          send_state?: string | null
          sent_at?: string
        }
        Relationships: []
      }
      zapier_inbound_events: {
        Row: {
          created_lead: boolean
          event_id: string
          lead_id: string | null
          pipeline_id: string | null
          received_at: string
        }
        Insert: {
          created_lead?: boolean
          event_id: string
          lead_id?: string | null
          pipeline_id?: string | null
          received_at?: string
        }
        Update: {
          created_lead?: boolean
          event_id?: string
          lead_id?: string | null
          pipeline_id?: string | null
          received_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      universe_confirmed_sources: {
        Row: {
          amount: number | null
          date: string | null
          description: string | null
          editable: boolean | null
          id: string | null
          origin: string | null
          reference: string | null
          revision: number | null
          status: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_crm_calendar_blocked: {
        Args: {
          p_actor: string
          p_end: string
          p_reason: string
          p_start: string
        }
        Returns: string
      }
      add_crm_client_knowledge: {
        Args: {
          p_actor: string
          p_client: string
          p_kind: string
          p_source: string
          p_text: string
          p_title: string
        }
        Returns: string
      }
      add_crm_client_record: {
        Args: {
          p_actor: string
          p_client: string
          p_description: string
          p_kind: string
        }
        Returns: string
      }
      add_crm_project_history: {
        Args: {
          p_author: string
          p_content: string
          p_event: string
          p_kind: string
          p_project: string
        }
        Returns: undefined
      }
      analysis_contact_snapshot: {
        Args: { p_instance: string; p_key: string }
        Returns: Json
      }
      apply_b2b_public_enrichment: {
        Args: {
          p_cnpj: string
          p_fields: Json
          p_lead: string
          p_note: string
          p_profile: Json
          p_replace: string[]
        }
        Returns: Json
      }
      apply_crm_agent_decision: { Args: { p_run: string }; Returns: string }
      apply_hypercash_snapshot: {
        Args: {
          p_charges: Json
          p_lease: string
          p_revision: number
          p_subs: Json
        }
        Returns: undefined
      }
      approve_crm_client_plan: {
        Args: {
          p_actor: string
          p_plan: string
          p_revision: number
          p_version: number
        }
        Returns: undefined
      }
      arm_first_contact_queue: { Args: never; Returns: undefined }
      b2b_prep_enqueue_lead: { Args: { p_lead: string }; Returns: undefined }
      begin_crm_agent_send: { Args: { p_run: string }; Returns: boolean }
      bind_instagram_account: {
        Args: {
          p_author: string
          p_company: string
          p_instagram: string
          p_username: string
        }
        Returns: string
      }
      bind_portal_whatsapp_notification: {
        Args: { p_instance: string; p_notification: string; p_request: string }
        Returns: boolean
      }
      block_crm_agent: {
        Args: { p_reason: string; p_settings: string }
        Returns: undefined
      }
      book_crm_appointment: {
        Args: {
          p_actor: string
          p_end: string
          p_event: string
          p_lead: string
          p_origin: string
          p_start: string
          p_summary: string
        }
        Returns: string
      }
      bulk_crm_client_tasks: {
        Args: {
          p_action: string
          p_actor: string
          p_ids: string[]
          p_priority: string
        }
        Returns: number
      }
      cancel_crm_appointment: {
        Args: { p_actor: string; p_id: string }
        Returns: undefined
      }
      cancel_crm_campaign: {
        Args: { p_id: string; p_revision: number }
        Returns: boolean
      }
      cancel_crm_campaign_schedule: {
        Args: { p_cancelled: string[]; p_id: string; p_revision: number }
        Returns: Json
      }
      cancel_crm_client_charge: {
        Args: { p_actor: string; p_charge: string; p_revision: number }
        Returns: undefined
      }
      cancel_first_contact: {
        Args: {
          p_ambiguous?: boolean
          p_at: string
          p_id: string
          p_instance: string
          p_phone: string
        }
        Returns: number
      }
      capture_crm_reference_message: {
        Args: { p_instance: string; p_message: string }
        Returns: Json
      }
      claim_ai_learning: {
        Args: { p_run: string; p_token: string }
        Returns: boolean
      }
      claim_analysis_message: {
        Args: { p_author: string; p_id: string; p_text: string }
        Returns: Json
      }
      claim_b2b_ai_email_batch: {
        Args: { p_id: string; p_token: string }
        Returns: boolean
      }
      claim_b2b_company_insight: {
        Args: { p_lead: string; p_token: string }
        Returns: boolean
      }
      claim_b2b_lookup: {
        Args: { p_key: string; p_provider: string }
        Returns: boolean
      }
      claim_b2b_prep: {
        Args: { p_limit: number; p_token: string }
        Returns: string[]
      }
      claim_b2b_public_enrichment: {
        Args: { p_limit: number }
        Returns: string[]
      }
      claim_crm_agent: {
        Args: { p_inbound: string; p_instance: string }
        Returns: Json
      }
      claim_crm_campaign_email: {
        Args: {
          p_batch: string
          p_id: string
          p_recipients: Json
          p_revision: number
          p_scheduled_at: string
        }
        Returns: Json
      }
      claim_crm_cs_analysis: {
        Args: { p_client: string; p_event: string }
        Returns: {
          client_id: string
          completed_at: string | null
          created_at: string
          diagnosis: Json | null
          event_id: string
          id: string
          limitation: string
          message_count: number
          period_end: string | null
          period_start: string | null
          source_revision: number
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "crm_cs_evaluations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_crm_email_flow_runner: {
        Args: { p_seconds: number; p_token: string }
        Returns: boolean
      }
      claim_crm_notification: {
        Args: {
          p_body: string
          p_channel: string
          p_event: string
          p_event_key: string
          p_title: string
          p_url: string
        }
        Returns: string
      }
      claim_crm_whatsapp_delivery: {
        Args: { p_campaign: string }
        Returns: Json
      }
      claim_diagnosis_whatsapp: {
        Args: { p_id: string; p_lease: string }
        Returns: Json
      }
      claim_first_contact: {
        Args: { p_id: string; p_lease: string }
        Returns: Json
      }
      claim_first_contact_test: {
        Args: {
          p_author: string
          p_first: string
          p_instance: string
          p_phone: string
          p_sender: string
        }
        Returns: Json
      }
      claim_first_contact_worker: {
        Args: { p_lease: string }
        Returns: boolean
      }
      claim_full_first_contact_test_step: {
        Args: { p_author: string; p_id: string }
        Returns: Json
      }
      claim_gravon_reserved_echo: {
        Args: {
          p_body: string
          p_id: string
          p_instance: string
          p_jid: string
        }
        Returns: boolean
      }
      claim_hypercash_sync: { Args: { p_lease: string }; Returns: boolean }
      claim_lead_ai_qualifications: {
        Args: { p_lease: string; p_limit: number }
        Returns: {
          company: string
          lead_id: string
          name: string
          same_phone: number
          service: string
          whatsapp: string
        }[]
      }
      claim_meta_capi_lead_events: {
        Args: { p_limit: number }
        Returns: {
          event_id: string
          event_name: string
          event_time: string
          id: string
          lead_id: string
          pixel_id: string
        }[]
      }
      claim_next_crm_agent_run: { Args: { p_contact: string }; Returns: Json }
      claim_paced_crm_whatsapp_delivery: {
        Args: { p_campaign: string }
        Returns: Json
      }
      claim_polp_consent_renewal: {
        Args: { p_consent_id: string; p_lease_seconds?: number }
        Returns: string
      }
      claim_polp_sync: {
        Args: {
          p_company_key: string
          p_consent_id: string
          p_from: string
          p_lease_seconds?: number
          p_mode: string
          p_to: string
          p_trigger: string
        }
        Returns: string
      }
      claim_portal_ads_sync: {
        Args: { p_from: string; p_lease: string; p_to: string }
        Returns: boolean
      }
      claim_portal_whatsapp_notification: {
        Args: {
          p_consent_at: string
          p_evidence: string
          p_fingerprint: string
          p_notification: string
          p_phone: string
          p_policy: string
          p_project: string
          p_request: string
          p_version: string
        }
        Returns: Json
      }
      claim_whatsapp_group_sync: {
        Args: {
          p_company: string
          p_force?: boolean
          p_instance: string
          p_phone: string
          p_token: string
        }
        Returns: boolean
      }
      commercial_knowledge_access: {
        Args: { p_author: string; p_company: string }
        Returns: boolean
      }
      commit_ai_learning: {
        Args: {
          p_insights?: Json
          p_item?: number
          p_offset?: number
          p_publish?: boolean
          p_result?: Json
          p_run: string
          p_token: string
        }
        Returns: boolean
      }
      complete_crm_campaign_dispatch: {
        Args: { p_id: string }
        Returns: string
      }
      complete_instagram_oauth: {
        Args: {
          p_author: string
          p_binding: string
          p_company: string
          p_state: string
        }
        Returns: Json
      }
      configure_portal_ads_schedule: {
        Args: { p_credential: string }
        Returns: undefined
      }
      confirm_hypercash_receipt: {
        Args: {
          p_account: string
          p_actor: string
          p_charge: string
          p_target_charge?: string
          p_target_payment?: string
        }
        Returns: Json
      }
      confirm_lead_closed_value: {
        Args: { p_actor: string; p_lead: string; p_value: number }
        Returns: Json
      }
      convert_lead_to_client: {
        Args: {
          p_actor: string
          p_internal_responsible: string
          p_lead: string
          p_notes: string
          p_services: string[]
          p_status: string
        }
        Returns: string
      }
      correct_crm_receipt_payment: {
        Args: {
          p_actor: string
          p_expected_charge: string
          p_operation: string
          p_payment: string
          p_reason: string
          p_target: string
        }
        Returns: boolean
      }
      create_b2b_ai_email_batch: {
        Args: {
          p_companies: Json
          p_key: string
          p_sender: string
          p_template: string
        }
        Returns: string
      }
      create_crm_client_ai_task: {
        Args: {
          p_actor: string
          p_client: string
          p_dedupe: string
          p_description: string
          p_due: string
          p_priority: string
          p_quote: string
          p_source_message: string
          p_status: string
          p_title: string
        }
        Returns: string
      }
      create_crm_client_card: {
        Args: { p_actor: string; p_client: string }
        Returns: string
      }
      create_crm_client_message_task: {
        Args: {
          p_actor: string
          p_client: string
          p_dedupe: string
          p_description: string
          p_due: string
          p_quote: string
          p_responsible: string
          p_source_message: string
          p_title: string
        }
        Returns: Json
      }
      create_due_charge_reminders: {
        Args: { p_actor: string }
        Returns: number
      }
      create_finance_series: {
        Args: {
          p_actor: string
          p_entries: Json
          p_operation: string
          p_scope: string
        }
        Returns: string
      }
      crm_agent_contact_block: { Args: { p_contact: string }; Returns: string }
      crm_agent_context: { Args: { p_run: string }; Returns: Json }
      crm_agent_day_start: { Args: never; Returns: string }
      crm_agent_human_since: {
        Args: { p_contact: string; p_instance: string; p_since: string }
        Returns: boolean
      }
      crm_agent_now: { Args: never; Returns: string }
      crm_agent_pending_sync: { Args: never; Returns: string[] }
      crm_agent_text_array: {
        Args: { p: Json; p_len: number; p_max: number }
        Returns: string[]
      }
      crm_automation_append_history: {
        Args: { p_id: string; p_lead: string; p_text: string }
        Returns: undefined
      }
      crm_automation_apply_actions: {
        Args: {
          p_actions: Json
          p_automation: string
          p_label: string
          p_lead: string
          p_pipeline: string
          p_run: string
        }
        Returns: string
      }
      crm_campaign_phone_norm: { Args: { p: string }; Returns: string }
      crm_email_flow_in_window: {
        Args: { p_at: string; p_days: number[]; p_end: string; p_start: string }
        Returns: boolean
      }
      crm_email_flow_step_due: {
        Args: { p_index: number; p_started: string; p_steps: Json }
        Returns: string
      }
      crm_email_inbox_history: {
        Args: { p_inbox: string; p_lead: string }
        Returns: undefined
      }
      crm_email_norm_id: { Args: { v: string }; Returns: string }
      crm_email_sent_effects: {
        Args: { p_key: string; p_lead: string; p_text: string }
        Returns: string
      }
      crm_normalize_reference: { Args: { p: string }; Returns: string }
      crm_phone_digits: { Args: { p: string }; Returns: string }
      crm_phone_key: { Args: { p: string }; Returns: string }
      crm_same_whatsapp: { Args: { a: string; b: string }; Returns: boolean }
      delete_crm_reference_message: {
        Args: { p_id: string; p_revision: number }
        Returns: boolean
      }
      detect_crm_automation_forms: { Args: never; Returns: number }
      diagnosis_channel_allowed: {
        Args: { p_actor: string; p_instance: string; p_sender: string }
        Returns: boolean
      }
      discard_crm_email_flow_suggestion: {
        Args: { p_revision: number; p_suggestion: string }
        Returns: boolean
      }
      dispatch_first_contact_wake: { Args: never; Returns: undefined }
      enroll_crm_email_flow: {
        Args: { p_flow: string; p_leads: string[] }
        Returns: Json
      }
      enroll_first_contact: {
        Args: {
          p_consent_at: string
          p_event: string
          p_first: string
          p_lead: string
          p_origin: string
          p_phone: string
          p_version: string
        }
        Returns: string
      }
      finance_available_account: {
        Args: { p_account: string; p_scope: string }
        Returns: number
      }
      finance_scope_allowed: {
        Args: { p_actor: string; p_scope: string }
        Returns: boolean
      }
      finish_b2b_ai_email_item: {
        Args: {
          p_batch: string
          p_body: string
          p_item: string
          p_subject: string
          p_token: string
        }
        Returns: boolean
      }
      finish_b2b_ai_email_item_v2: {
        Args: {
          p_batch: string
          p_body: string
          p_fact: string
          p_item: string
          p_source: string
          p_subject: string
          p_sufficient: boolean
          p_token: string
          p_whatsapp: string
        }
        Returns: boolean
      }
      finish_b2b_ai_email_send: {
        Args: {
          p_error: string
          p_id: string
          p_provider_id: string
          p_state: string
        }
        Returns: boolean
      }
      finish_b2b_company_insight: {
        Args: {
          p_error: string
          p_insight: Json
          p_lead: string
          p_sources: Json
          p_status: string
          p_token: string
        }
        Returns: boolean
      }
      finish_crm_agent_analysis: {
        Args: {
          p_analysis: Json
          p_human: string
          p_reply: string
          p_run: string
        }
        Returns: boolean
      }
      finish_crm_campaign_delivery: {
        Args: {
          p_delivery: string
          p_error: string
          p_message_id: string
          p_state: string
        }
        Returns: boolean
      }
      finish_crm_campaign_test: {
        Args: {
          p_campaign: string
          p_error: string
          p_message_id: string
          p_recipient: string
          p_state: string
        }
        Returns: boolean
      }
      finish_crm_email_flow_reply: {
        Args: {
          p_error: string
          p_provider_id: string
          p_state: string
          p_suggestion: string
        }
        Returns: boolean
      }
      finish_crm_email_flow_step: {
        Args: {
          p_error: string
          p_message: string
          p_provider_id: string
          p_state: string
        }
        Returns: string
      }
      finish_crm_notification: {
        Args: { p_error: string; p_id: string; p_status: string }
        Returns: undefined
      }
      finish_crm_whatsapp_delivery: {
        Args: {
          p_error: string
          p_id: string
          p_message_id: string
          p_state: string
        }
        Returns: boolean
      }
      finish_diagnosis_whatsapp: {
        Args: {
          p_at: string
          p_error: string
          p_id: string
          p_jid: string
          p_lease: string
          p_provider: string
          p_state: string
        }
        Returns: boolean
      }
      finish_first_contact: {
        Args: {
          p_at: string
          p_error: string
          p_id: string
          p_lease: string
          p_provider: string
          p_state: string
        }
        Returns: boolean
      }
      finish_full_first_contact_test_step: {
        Args: {
          p_at: string
          p_error: string
          p_id: string
          p_jid: string
          p_provider: string
          p_state: string
          p_step: number
        }
        Returns: boolean
      }
      finish_instagram_greeting: {
        Args: {
          p_account: string
          p_contact: string
          p_mid: string
          p_now: string
          p_state: string
        }
        Returns: undefined
      }
      finish_lead_ai_qualification: {
        Args: {
          p_error: string
          p_evidence: Json
          p_fingerprint: string
          p_fit: string
          p_last_inbound: string
          p_lead: string
          p_lease: string
          p_outcome: string
          p_summary: string
        }
        Returns: string
      }
      finish_polp_sync: {
        Args: {
          p_company_key: string
          p_consent_id: string
          p_error_code: string
          p_run: string
          p_skipped: number
          p_status: string
        }
        Returns: boolean
      }
      finish_portal_whatsapp_notification: {
        Args: {
          p_jid: string
          p_notification: string
          p_provider: string
          p_request: string
          p_state: string
        }
        Returns: boolean
      }
      finish_whatsapp_group_sync: {
        Args: {
          p_company: string
          p_error?: string
          p_groups: Json
          p_instance: string
          p_phone: string
          p_token: string
        }
        Returns: boolean
      }
      first_contact_number: { Args: { p: string }; Returns: string }
      first_contact_reply_blocks: {
        Args: { p_contact: string; p_instance: string; p_started: string }
        Returns: boolean
      }
      full_first_contact_test_guard: {
        Args: { p_author: string; p_instance: string; p_sender: string }
        Returns: boolean
      }
      gravon_closed_value: {
        Args: {
          p_field: string
          p_finance_revision: string
          p_instance: string
          p_phone: string
          p_query: string
          p_revision: string
        }
        Returns: Json
      }
      gravon_count_leads: {
        Args: {
          p_end?: string
          p_instance: string
          p_phone: string
          p_revision: string
          p_stage?: string
          p_start?: string
        }
        Returns: Json
      }
      gravon_lookup_lead: {
        Args: {
          p_field: string
          p_instance: string
          p_phone: string
          p_query: string
          p_revision: string
        }
        Returns: Json
      }
      gravon_propose_stage_move: {
        Args: {
          p_field: string
          p_inbound_id: string
          p_instance: string
          p_move_revision: string
          p_phone: string
          p_query: string
          p_read_revision: string
          p_target_stage: string
        }
        Returns: Json
      }
      gravon_require_finance_grant: {
        Args: {
          p_finance_revision: string
          p_instance: string
          p_phone: string
          p_revision: string
        }
        Returns: boolean
      }
      gravon_require_move_grant: {
        Args: {
          p_instance: string
          p_move_revision: string
          p_phone: string
          p_read_revision: string
        }
        Returns: boolean
      }
      gravon_require_read_grant: {
        Args: { p_instance: string; p_phone: string; p_revision: string }
        Returns: boolean
      }
      gravon_resolve_stage_move: {
        Args: {
          p_cancel: boolean
          p_code: string
          p_inbound_id: string
          p_instance: string
          p_move_revision: string
          p_phone: string
          p_read_revision: string
        }
        Returns: Json
      }
      gravon_sales_summary: {
        Args: {
          p_end: string
          p_finance_revision: string
          p_instance: string
          p_phone: string
          p_revision: string
          p_start: string
        }
        Returns: Json
      }
      gravon_stage_action_result: {
        Args: {
          p_action: Database["public"]["Tables"]["gravon_lead_stage_actions"]["Row"]
        }
        Returns: Json
      }
      import_b2b_companies: {
        Args: { p_companies: Json; p_pipeline: string }
        Returns: Json
      }
      ingest_instagram_message: {
        Args: {
          p_account: string
          p_body: string
          p_inbound: boolean
          p_kind: string
          p_mid: string
          p_now: string
          p_sender: string
          p_sent: string
        }
        Returns: Json
      }
      link_crm_client_card: {
        Args: { p_actor: string; p_client: string; p_lead: string }
        Returns: string
      }
      link_hypercash_payout: {
        Args: {
          p_actor: string
          p_bank: string
          p_charges: string[]
          p_fee: number
        }
        Returns: undefined
      }
      pause_crm_whatsapp_campaign: {
        Args: { p_id: string; p_pause: boolean }
        Returns: string
      }
      persist_first_contact_test: { Args: { p_id: string }; Returns: boolean }
      persist_lead_interaction: {
        Args: {
          p_call_id?: string
          p_company?: string
          p_entry: Json
          p_instance?: string
          p_lead: string
        }
        Returns: Json
      }
      polp_sync_assert_lease: {
        Args: { p_company_key: string; p_consent_id: string; p_run: string }
        Returns: undefined
      }
      process_crm_automation_entries: {
        Args: { p_limit: number }
        Returns: number
      }
      quarantine_crm_agent_runs: { Args: never; Returns: number }
      receive_crm_diagnosis: {
        Args: {
          p_company: string
          p_email: string
          p_event_id: string
          p_key_hash: string
          p_name: string
          p_objective: string
          p_utm_content: string
          p_whatsapp: string
        }
        Returns: Json
      }
      receive_crm_diagnosis_v2: {
        Args: {
          p_body: string
          p_company: string
          p_consent: Json
          p_email: string
          p_event_id: string
          p_key_hash: string
          p_name: string
          p_objective: string
          p_phone: string
          p_utm_content: string
          p_whatsapp: string
        }
        Returns: Json
      }
      reconcile_analysis_delivery: {
        Args: { p_id: string; p_instance: string }
        Returns: undefined
      }
      reconcile_polp_bank_receipt: {
        Args: {
          p_account: string
          p_actor: string
          p_company_key: string
          p_mode: string
          p_operation: string
          p_target: string
          p_target_id: string
          p_transaction_id: string
        }
        Returns: Json
      }
      record_b2b_ai_whatsapp_manual: {
        Args: { p_id: string }
        Returns: boolean
      }
      record_crm_agent_send: {
        Args: {
          p_accepted: string
          p_error: string
          p_provider: string
          p_run: string
        }
        Returns: undefined
      }
      record_crm_automation_click: { Args: { p_token: string }; Returns: Json }
      record_crm_campaign_consent: {
        Args: {
          p_channel: string
          p_contact: string
          p_evidence: string
          p_granted_at: string
          p_lead: string
          p_withdraw?: boolean
        }
        Returns: boolean
      }
      record_crm_campaign_test_recipient: {
        Args: {
          p_email: string
          p_evidence: string
          p_label: string
          p_recorded_by: string
          p_revoke?: boolean
        }
        Returns: boolean
      }
      record_crm_email_flow_reply: {
        Args: {
          p_body: string
          p_enrollment: string
          p_gmail_id: string
          p_opt_out: boolean
          p_rfc_id: string
          p_subject: string
        }
        Returns: string
      }
      record_crm_email_inbox: {
        Args: { p: Json; p_refs: string[] }
        Returns: Json
      }
      record_meta_capi_attempt: {
        Args: {
          p_code: string
          p_event: string
          p_http: number
          p_outcome: string
          p_request: Json
          p_response: Json
          p_trigger: string
        }
        Returns: string
      }
      record_outbound_email_click: {
        Args: {
          p_classification: string
          p_fingerprint: string
          p_record?: boolean
          p_token: string
        }
        Returns: string
      }
      record_polp_bank_accounts: {
        Args: {
          p_accounts: Json
          p_company_key: string
          p_consent_id: string
          p_run: string
        }
        Returns: number
      }
      refresh_crm_charge_status: { Args: never; Returns: number }
      register_crm_client_payment: {
        Args: {
          p_actor: string
          p_amount: number
          p_charge: string
          p_confirmed: boolean
          p_method: string
          p_note: string
        }
        Returns: string
      }
      register_finance_client_payment: {
        Args: {
          p_account: string
          p_actor: string
          p_amount: number
          p_charge: string
          p_confirmed: boolean
          p_date: string
          p_operation: string
        }
        Returns: string
      }
      register_outbound_email_link: {
        Args: { p_message: string; p_url: string }
        Returns: string
      }
      release_b2b_prep: {
        Args: { p_blocked: string; p_result: Json; p_token: string }
        Returns: undefined
      }
      release_crm_agent_hold: {
        Args: { p_actor: string; p_contact: string }
        Returns: undefined
      }
      release_crm_email_flow_runner: {
        Args: { p_gmail: boolean; p_result: Json; p_token: string }
        Returns: undefined
      }
      release_polp_consent_renewal: {
        Args: { p_consent_id: string; p_lease_id: string }
        Returns: boolean
      }
      remove_crm_calendar_blocked: {
        Args: { p_actor: string; p_id: string }
        Returns: undefined
      }
      reorder_crm_tasks: {
        Args: { p_context: string; p_ids: string[] }
        Returns: undefined
      }
      request_meta_capi_retry: {
        Args: { p_company: string; p_event: string }
        Returns: string
      }
      reschedule_crm_appointment: {
        Args: { p_actor: string; p_end: string; p_id: string; p_start: string }
        Returns: undefined
      }
      reserve_b2b_ai_email_send: {
        Args: { p_id: string; p_revision: number; p_scheduled_at?: string }
        Returns: Json
      }
      reserve_b2b_request: {
        Args: { p_daily_limit: number; p_provider: string }
        Returns: string
      }
      reserve_crm_campaign_test: {
        Args: {
          p_campaign: string
          p_limit: number
          p_recipient: string
          p_window_seconds: number
        }
        Returns: string
      }
      reserve_crm_email_flow_reply: {
        Args: {
          p_body: string
          p_revision: number
          p_subject: string
          p_suggestion: string
        }
        Returns: Json
      }
      reserve_crm_email_flow_step: {
        Args: {
          p_ai: boolean
          p_body: string
          p_enrollment: string
          p_step: number
          p_subject: string
        }
        Returns: string
      }
      resolve_analysis_qualification: {
        Args: { p_cancel: boolean; p_id: string }
        Returns: Json
      }
      resolve_analysis_qualification_with_notes: {
        Args: { p_cancel: boolean; p_id: string; p_notes: string }
        Returns: Json
      }
      resolve_crm_email_inbox: {
        Args: {
          p_action: string
          p_company: string
          p_id: string
          p_lead: string
          p_name: string
          p_pipeline: string
        }
        Returns: Json
      }
      revalidate_diagnosis_whatsapp: {
        Args: { p_id: string; p_lease: string }
        Returns: boolean
      }
      revalidate_first_contact: {
        Args: { p_id: string; p_lease: string }
        Returns: boolean
      }
      revalidate_full_first_contact_test: {
        Args: { p_author: string; p_id: string }
        Returns: boolean
      }
      review_b2b_ai_email: {
        Args: {
          p_body: string
          p_id: string
          p_reviewed: boolean
          p_revision: number
          p_subject: string
        }
        Returns: boolean
      }
      review_b2b_ai_email_item: {
        Args: {
          p_body: string
          p_id: string
          p_recipient: string
          p_reviewed: boolean
          p_revision: number
          p_subject: string
        }
        Returns: number
      }
      review_b2b_ai_email_item_v2: {
        Args: {
          p_body: string
          p_id: string
          p_recipient: string
          p_reviewed: boolean
          p_revision: number
          p_subject: string
          p_whatsapp: string
        }
        Returns: number
      }
      review_polp_bank_batch: {
        Args: {
          p_actor: string
          p_company_key: string
          p_items: Json
          p_operation: string
        }
        Returns: number
      }
      save_crm_agent_settings: {
        Args: {
          p_actor: string
          p_config: Json
          p_pipeline: string
          p_revision: number
        }
        Returns: Json
      }
      save_crm_automation: {
        Args: {
          p_compile_ok: boolean
          p_compiled: Json
          p_graph: Json
          p_id: string
          p_landing: string
          p_name: string
          p_pipeline: string
          p_revision: number
          p_slug: string
          p_tests: string[]
        }
        Returns: Json
      }
      save_crm_calendar_settings: {
        Args: {
          p_actor: string
          p_calendar: string
          p_days: number[]
          p_duration: number
          p_enabled: boolean
          p_end: string
          p_gap: number
          p_lunch_end: string
          p_lunch_start: string
          p_notice: number
          p_responsible: string
          p_revision: number
          p_start: string
        }
        Returns: undefined
      }
      save_crm_campaign_draft: {
        Args: { p_id: string; p_payload: Json; p_revision: number }
        Returns: Json
      }
      save_crm_campaign_email_settings: {
        Args: { p_payload: Json; p_revision: number }
        Returns: Json
      }
      save_crm_campaign_pacing: {
        Args: {
          p_campaign: string
          p_every: number
          p_max: number
          p_min: number
          p_pause: number
        }
        Returns: boolean
      }
      save_crm_client: {
        Args: {
          p_actor: string
          p_address: string
          p_cnpj: string
          p_contact_name: string
          p_email: string
          p_id: string
          p_internal_responsible: string
          p_lead: string
          p_legal_name: string
          p_notes: string
          p_phone: string
          p_relationship_start: string
          p_reminder_days: number
          p_revision: number
          p_services: string[]
          p_status: string
          p_trade_name: string
          p_website: string
          p_whatsapp: string
        }
        Returns: string
      }
      save_crm_client_charge: {
        Args: {
          p_actor: string
          p_amount: number
          p_client: string
          p_description: string
          p_due: string
          p_id: string
          p_interval: number
          p_method: string
          p_recurrence: string
          p_revision: number
        }
        Returns: string
      }
      save_crm_client_plan: {
        Args: {
          p_actor: string
          p_client: string
          p_content: string
          p_expected_version: number
          p_origin: string
          p_plan: string
          p_title: string
        }
        Returns: string
      }
      save_crm_client_task: {
        Args: {
          p_actor: string
          p_client: string
          p_description: string
          p_due: string
          p_id: string
          p_origin: string
          p_priority: string
          p_responsible: string
          p_revision: number
          p_status: string
          p_title: string
        }
        Returns: string
      }
      save_crm_email_flow: {
        Args: {
          p_ai: boolean
          p_approve_ai: boolean
          p_id: string
          p_name: string
          p_revision: number
          p_steps: Json
        }
        Returns: Json
      }
      save_crm_email_flow_schedule: {
        Args: {
          p_days: number[]
          p_end: string
          p_id: string
          p_max: number
          p_revision: number
          p_start: string
        }
        Returns: Json
      }
      save_crm_email_flow_suggestion: {
        Args: {
          p_analysis: string
          p_body: string
          p_inbound: string
          p_subject: string
        }
        Returns: string
      }
      save_crm_project: {
        Args: {
          p_author: string
          p_data: Json
          p_event: string
          p_id: string
          p_revision: number
        }
        Returns: Json
      }
      save_crm_receipt_schedule: {
        Args: {
          p_actor: string
          p_client: string
          p_config: Json
          p_generate: boolean
          p_id: string
          p_operation: string
          p_project: string
          p_revision: number
        }
        Returns: string
      }
      save_crm_reference_message: {
        Args: {
          p_active: boolean
          p_actor: string
          p_body: string
          p_id: string
          p_mode: string
          p_pipeline: string
          p_revision: number
          p_source: string
          p_stage: string
        }
        Returns: Json
      }
      save_diagnosis_automation: {
        Args: {
          p_actor: string
          p_enabled: boolean
          p_instance: string
          p_revision: number
          p_sender: string
        }
        Returns: boolean
      }
      save_finance_record: {
        Args: {
          p_actor: string
          p_data: Json
          p_id: string
          p_kind: string
          p_operation: string
          p_revision: number
          p_scope: string
        }
        Returns: string
      }
      save_first_contact_options: {
        Args: {
          p_author: string
          p_enabled: boolean
          p_instance: string
          p_interval: number
          p_phone: string
          p_revision: string
          p_stop_on_reply: boolean
        }
        Returns: boolean
      }
      save_first_contact_settings: {
        Args: {
          p_author: string
          p_enabled: boolean
          p_instance: string
          p_interval: number
          p_phone: string
          p_revision: string
        }
        Returns: boolean
      }
      save_gravon_accepted_message: {
        Args: {
          p_accepted_at: string
          p_body: string
          p_instance: string
          p_message_id: string
          p_phone_key: string
          p_remote_jid: string
        }
        Returns: boolean
      }
      save_polp_bank_classification: {
        Args: {
          p_actor: string
          p_category: string
          p_company_key: string
          p_expected_revision: number
          p_kind: string
          p_rule_direction: string
          p_rule_field: string
          p_rule_pattern: string
          p_transaction_id: string
          p_vendor: string
        }
        Returns: Json
      }
      save_polp_bank_classifications: {
        Args: { p_actor: string; p_company_key: string; p_items: Json }
        Returns: number
      }
      save_universe_receipt: {
        Args: {
          p_actor: string
          p_data: Json
          p_event: string
          p_id: string
          p_reason: string
          p_revision: number
        }
        Returns: Json
      }
      save_universe_targets: {
        Args: {
          p_actor: string
          p_event: string
          p_lifetime: number[]
          p_monthly: number[]
          p_reason: string
          p_revision: number
        }
        Returns: undefined
      }
      set_crm_agent_contact_control: {
        Args: {
          p_actor: string
          p_contact: string
          p_hours: number
          p_mode: string
          p_revision: number
        }
        Returns: Json
      }
      set_crm_automation_run: {
        Args: { p_action: string; p_run: string }
        Returns: boolean
      }
      set_crm_automation_state: {
        Args: {
          p_approve_ai: boolean
          p_id: string
          p_revision: number
          p_state: string
        }
        Returns: Json
      }
      set_crm_email_agent_enabled: {
        Args: { p_enabled: boolean }
        Returns: boolean
      }
      set_crm_email_flow_enrollment: {
        Args: { p_action: string; p_id: string }
        Returns: boolean
      }
      set_crm_email_flow_state: {
        Args: { p_id: string; p_revision: number; p_state: string }
        Returns: Json
      }
      set_polp_bank_rule_active: {
        Args: {
          p_active: boolean
          p_actor: string
          p_company_key: string
          p_rule_id: string
        }
        Returns: boolean
      }
      settle_b2b_ai_email_sends: { Args: never; Returns: number }
      settle_crm_automation_runs: { Args: never; Returns: number }
      settle_crm_campaigns: { Args: never; Returns: number }
      settle_crm_email_flows: { Args: never; Returns: number }
      start_ai_learning: { Args: never; Returns: string }
      start_crm_automation_run: {
        Args: { p_automation: string; p_lead: string; p_source: string }
        Returns: Json
      }
      start_crm_whatsapp_campaign: {
        Args: {
          p_actor: string
          p_id: string
          p_recipients: Json
          p_revision: number
          p_statement: string
        }
        Returns: number
      }
      start_full_first_contact_test: {
        Args: {
          p_author: string
          p_first: string
          p_instance: string
          p_phone: string
          p_sender: string
        }
        Returns: Json
      }
      stop_crm_whatsapp_campaign: { Args: { p_id: string }; Returns: number }
      sync_crm_agent_send: { Args: { p_run: string }; Returns: undefined }
      universe_assert: { Args: { p_actor: string }; Returns: undefined }
      universe_refresh_awards: { Args: never; Returns: undefined }
      update_crm_cs_management: {
        Args: {
          p_actor: string
          p_client: string
          p_event: string
          p_management: Json
          p_note: string
          p_revision: number
        }
        Returns: Json
      }
      update_crm_customer_success: {
        Args: {
          p_actor: string
          p_client: string
          p_evaluation?: string
          p_event: string
          p_followup?: string
          p_health?: string
          p_note?: string
          p_revision: number
          p_stage?: string
        }
        Returns: Json
      }
      upsert_polp_bank_transactions: {
        Args: {
          p_company_key: string
          p_consent_id: string
          p_rows: Json
          p_run: string
        }
        Returns: Json
      }
      wake_b2b_prep: { Args: never; Returns: undefined }
      wake_first_contact_on_enrollment: { Args: never; Returns: undefined }
      wake_lead_ai_qualification: { Args: never; Returns: undefined }
      write_commercial_knowledge: {
        Args: {
          p_author: string
          p_company: string
          p_event: string
          p_id: string
          p_operation: string
          p_origin: string
          p_revision: number
          p_text: string
          p_title: string
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
