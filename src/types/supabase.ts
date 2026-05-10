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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string
          created_at: string | null
          details: Json | null
          id: string
          ip_address: string | null
          resource_id: string | null
          resource_type: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          details?: Json | null
          id?: string
          ip_address?: string | null
          resource_id?: string | null
          resource_type?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          details?: Json | null
          id?: string
          ip_address?: string | null
          resource_id?: string | null
          resource_type?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_vouchers: {
        Row: {
          campaign_name: string
          code: string
          created_at: string | null
          created_by: string | null
          current_uses: number | null
          description: string | null
          discount_type: string
          discount_value: number | null
          id: string
          max_uses: number | null
          max_uses_per_customer: number | null
          metadata: Json | null
          notes: string | null
          product_ids: string[] | null
          product_skus: string[] | null
          status: string | null
          total_cost_absorbed: number | null
          total_vendor_payout: number | null
          updated_at: string | null
          valid_from: string | null
          valid_until: string | null
          vendor_ids: string[] | null
        }
        Insert: {
          campaign_name: string
          code: string
          created_at?: string | null
          created_by?: string | null
          current_uses?: number | null
          description?: string | null
          discount_type?: string
          discount_value?: number | null
          id?: string
          max_uses?: number | null
          max_uses_per_customer?: number | null
          metadata?: Json | null
          notes?: string | null
          product_ids?: string[] | null
          product_skus?: string[] | null
          status?: string | null
          total_cost_absorbed?: number | null
          total_vendor_payout?: number | null
          updated_at?: string | null
          valid_from?: string | null
          valid_until?: string | null
          vendor_ids?: string[] | null
        }
        Update: {
          campaign_name?: string
          code?: string
          created_at?: string | null
          created_by?: string | null
          current_uses?: number | null
          description?: string | null
          discount_type?: string
          discount_value?: number | null
          id?: string
          max_uses?: number | null
          max_uses_per_customer?: number | null
          metadata?: Json | null
          notes?: string | null
          product_ids?: string[] | null
          product_skus?: string[] | null
          status?: string | null
          total_cost_absorbed?: number | null
          total_vendor_payout?: number | null
          updated_at?: string | null
          valid_from?: string | null
          valid_until?: string | null
          vendor_ids?: string[] | null
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          description: string | null
          display_order: number | null
          id: string
          image_url: string | null
          name: string
          parent_id: string | null
          slug: string
          updated_at: string
          woo_term_id: number | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_order?: number | null
          id?: string
          image_url?: string | null
          name: string
          parent_id?: string | null
          slug: string
          updated_at?: string
          woo_term_id?: number | null
        }
        Update: {
          created_at?: string
          description?: string | null
          display_order?: number | null
          id?: string
          image_url?: string | null
          name?: string
          parent_id?: string | null
          slug?: string
          updated_at?: string
          woo_term_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      cj_inbound_shipments: {
        Row: {
          carrier_name: string | null
          cj_order_id: string | null
          cj_pid: string | null
          cj_vid: string | null
          created_at: string
          estimated_arrival_at: string | null
          hub_id: string | null
          id: string
          inbound_status: string
          inbound_tracking_number: string | null
          manual_supplier_order_id: string | null
          metadata: Json
          provider: string
          received_at_hub_at: string | null
          sub_order_id: string | null
          supplier_order_mode: string
          supplier_order_status: string
          supplier_ordered_at: string | null
          supplier_status: string | null
          updated_at: string
          vendor_id: string | null
          woo_order_id: string | null
        }
        Insert: {
          carrier_name?: string | null
          cj_order_id?: string | null
          cj_pid?: string | null
          cj_vid?: string | null
          created_at?: string
          estimated_arrival_at?: string | null
          hub_id?: string | null
          id?: string
          inbound_status?: string
          inbound_tracking_number?: string | null
          manual_supplier_order_id?: string | null
          metadata?: Json
          provider?: string
          received_at_hub_at?: string | null
          sub_order_id?: string | null
          supplier_order_mode?: string
          supplier_order_status?: string
          supplier_ordered_at?: string | null
          supplier_status?: string | null
          updated_at?: string
          vendor_id?: string | null
          woo_order_id?: string | null
        }
        Update: {
          carrier_name?: string | null
          cj_order_id?: string | null
          cj_pid?: string | null
          cj_vid?: string | null
          created_at?: string
          estimated_arrival_at?: string | null
          hub_id?: string | null
          id?: string
          inbound_status?: string
          inbound_tracking_number?: string | null
          manual_supplier_order_id?: string | null
          metadata?: Json
          provider?: string
          received_at_hub_at?: string | null
          sub_order_id?: string | null
          supplier_order_mode?: string
          supplier_order_status?: string
          supplier_ordered_at?: string | null
          supplier_status?: string | null
          updated_at?: string
          vendor_id?: string | null
          woo_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cj_inbound_shipments_hub_id_fkey"
            columns: ["hub_id"]
            isOneToOne: false
            referencedRelation: "hub_performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cj_inbound_shipments_hub_id_fkey"
            columns: ["hub_id"]
            isOneToOne: false
            referencedRelation: "hubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cj_inbound_shipments_manual_supplier_order_id_fkey"
            columns: ["manual_supplier_order_id"]
            isOneToOne: false
            referencedRelation: "manual_supplier_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cj_inbound_shipments_sub_order_id_fkey"
            columns: ["sub_order_id"]
            isOneToOne: false
            referencedRelation: "sub_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cj_inbound_shipments_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_earnings_summary"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "cj_inbound_shipments_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_api_logs: {
        Row: {
          courier_id: string | null
          created_at: string | null
          error_message: string | null
          id: string
          request_payload: Json | null
          request_type: string
          response_payload: Json | null
          status_code: number | null
          success: boolean | null
        }
        Insert: {
          courier_id?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          request_payload?: Json | null
          request_type: string
          response_payload?: Json | null
          status_code?: number | null
          success?: boolean | null
        }
        Update: {
          courier_id?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          request_payload?: Json | null
          request_type?: string
          response_payload?: Json | null
          status_code?: number | null
          success?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "courier_api_logs_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "courier_performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_api_logs_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_api_logs_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "pending_courier_payments"
            referencedColumns: ["courier_id"]
          },
        ]
      }
      courier_settlements: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          courier_id: string | null
          created_at: string | null
          id: string
          notes: string | null
          paid_at: string | null
          paid_by: string | null
          payment_date: string | null
          payment_method: string | null
          payment_reference: string | null
          settlement_period_end: string
          settlement_period_start: string
          status: string | null
          total_amount_due: number | null
          total_amount_paid: number | null
          total_shipments: number | null
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          courier_id?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          paid_at?: string | null
          paid_by?: string | null
          payment_date?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          settlement_period_end: string
          settlement_period_start: string
          status?: string | null
          total_amount_due?: number | null
          total_amount_paid?: number | null
          total_shipments?: number | null
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          courier_id?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          paid_at?: string | null
          paid_by?: string | null
          payment_date?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          settlement_period_end?: string
          settlement_period_start?: string
          status?: string | null
          total_amount_due?: number | null
          total_amount_paid?: number | null
          total_shipments?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "courier_settlements_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_settlements_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "courier_performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_settlements_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_settlements_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "pending_courier_payments"
            referencedColumns: ["courier_id"]
          },
          {
            foreignKeyName: "courier_settlements_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      couriers: {
        Row: {
          api_base_url: string | null
          api_config: Json | null
          api_credentials_encrypted: string | null
          api_enabled: boolean | null
          api_key: string | null
          api_key_encrypted: string | null
          api_password: string | null
          api_secret: string | null
          api_secret_encrypted: string | null
          api_url: string | null
          api_user_id: string | null
          api_username: string | null
          average_delivery_time_days: number | null
          base_rate: number | null
          code: string
          created_at: string | null
          environment: string
          excluded_zones: string[] | null
          id: string
          is_active: boolean | null
          last_api_sync: string | null
          metadata: Json | null
          name: string
          rate_per_kg: number | null
          service_zones: string[] | null
          success_rate: number | null
          supports_cod: boolean | null
          supports_label_generation: boolean | null
          supports_live_tracking: boolean | null
          supports_rate_calculation: boolean | null
          supports_tracking: boolean | null
          type: Database["public"]["Enums"]["courier_type"]
          updated_at: string | null
          webhook_url: string | null
        }
        Insert: {
          api_base_url?: string | null
          api_config?: Json | null
          api_credentials_encrypted?: string | null
          api_enabled?: boolean | null
          api_key?: string | null
          api_key_encrypted?: string | null
          api_password?: string | null
          api_secret?: string | null
          api_secret_encrypted?: string | null
          api_url?: string | null
          api_user_id?: string | null
          api_username?: string | null
          average_delivery_time_days?: number | null
          base_rate?: number | null
          code: string
          created_at?: string | null
          environment?: string
          excluded_zones?: string[] | null
          id?: string
          is_active?: boolean | null
          last_api_sync?: string | null
          metadata?: Json | null
          name: string
          rate_per_kg?: number | null
          service_zones?: string[] | null
          success_rate?: number | null
          supports_cod?: boolean | null
          supports_label_generation?: boolean | null
          supports_live_tracking?: boolean | null
          supports_rate_calculation?: boolean | null
          supports_tracking?: boolean | null
          type: Database["public"]["Enums"]["courier_type"]
          updated_at?: string | null
          webhook_url?: string | null
        }
        Update: {
          api_base_url?: string | null
          api_config?: Json | null
          api_credentials_encrypted?: string | null
          api_enabled?: boolean | null
          api_key?: string | null
          api_key_encrypted?: string | null
          api_password?: string | null
          api_secret?: string | null
          api_secret_encrypted?: string | null
          api_url?: string | null
          api_user_id?: string | null
          api_username?: string | null
          average_delivery_time_days?: number | null
          base_rate?: number | null
          code?: string
          created_at?: string | null
          environment?: string
          excluded_zones?: string[] | null
          id?: string
          is_active?: boolean | null
          last_api_sync?: string | null
          metadata?: Json | null
          name?: string
          rate_per_kg?: number | null
          service_zones?: string[] | null
          success_rate?: number | null
          supports_cod?: boolean | null
          supports_label_generation?: boolean | null
          supports_live_tracking?: boolean | null
          supports_rate_calculation?: boolean | null
          supports_tracking?: boolean | null
          type?: Database["public"]["Enums"]["courier_type"]
          updated_at?: string | null
          webhook_url?: string | null
        }
        Relationships: []
      }
      customer_feedback: {
        Row: {
          courier_rating: number | null
          created_at: string | null
          delivery_rating: number | null
          feedback_text: string | null
          has_issue: boolean | null
          id: string
          issue_description: string | null
          issue_resolved: boolean | null
          issue_type: string | null
          order_id: string | null
          resolution_notes: string | null
          resolved_at: string | null
          sub_order_id: string | null
        }
        Insert: {
          courier_rating?: number | null
          created_at?: string | null
          delivery_rating?: number | null
          feedback_text?: string | null
          has_issue?: boolean | null
          id?: string
          issue_description?: string | null
          issue_resolved?: boolean | null
          issue_type?: string | null
          order_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          sub_order_id?: string | null
        }
        Update: {
          courier_rating?: number | null
          created_at?: string | null
          delivery_rating?: number | null
          feedback_text?: string | null
          has_issue?: boolean | null
          id?: string
          issue_description?: string | null
          issue_resolved?: boolean | null
          issue_type?: string | null
          order_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          sub_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_feedback_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_feedback_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_feedback_sub_order_id_fkey"
            columns: ["sub_order_id"]
            isOneToOne: false
            referencedRelation: "sub_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_attempts: {
        Row: {
          attempt_number: number
          attempted_at: string
          attempted_location: string | null
          contacted_customer: boolean | null
          created_at: string | null
          customer_response: string | null
          failure_reason: string | null
          id: string
          metadata: Json | null
          rescheduled_for: string | null
          rider_name: string | null
          rider_phone: string | null
          status: string
          sub_order_id: string | null
        }
        Insert: {
          attempt_number: number
          attempted_at: string
          attempted_location?: string | null
          contacted_customer?: boolean | null
          created_at?: string | null
          customer_response?: string | null
          failure_reason?: string | null
          id?: string
          metadata?: Json | null
          rescheduled_for?: string | null
          rider_name?: string | null
          rider_phone?: string | null
          status: string
          sub_order_id?: string | null
        }
        Update: {
          attempt_number?: number
          attempted_at?: string
          attempted_location?: string | null
          contacted_customer?: boolean | null
          created_at?: string | null
          customer_response?: string | null
          failure_reason?: string | null
          id?: string
          metadata?: Json | null
          rescheduled_for?: string | null
          rider_name?: string | null
          rider_phone?: string | null
          status?: string
          sub_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_attempts_sub_order_id_fkey"
            columns: ["sub_order_id"]
            isOneToOne: false
            referencedRelation: "sub_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      device_tokens: {
        Row: {
          created_at: string | null
          customer_id: string
          fcm_token: string
          id: number
          last_used_at: string | null
          platform: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          customer_id: string
          fcm_token: string
          id?: number
          last_used_at?: string | null
          platform?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          customer_id?: string
          fcm_token?: string
          id?: number
          last_used_at?: string | null
          platform?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      email_config: {
        Row: {
          created_at: string | null
          created_by: string | null
          email_enabled: boolean | null
          email_from: string
          gmail_password: string | null
          gmail_user: string | null
          id: string
          portal_url: string
          provider: string
          sendgrid_api_key: string | null
          smtp_host: string | null
          smtp_password: string | null
          smtp_port: number | null
          smtp_user: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          email_enabled?: boolean | null
          email_from: string
          gmail_password?: string | null
          gmail_user?: string | null
          id?: string
          portal_url: string
          provider: string
          sendgrid_api_key?: string | null
          smtp_host?: string | null
          smtp_password?: string | null
          smtp_port?: number | null
          smtp_user?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          email_enabled?: boolean | null
          email_from?: string
          gmail_password?: string | null
          gmail_user?: string | null
          id?: string
          portal_url?: string
          provider?: string
          sendgrid_api_key?: string | null
          smtp_host?: string | null
          smtp_password?: string | null
          smtp_port?: number | null
          smtp_user?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_config_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      email_logs: {
        Row: {
          created_at: string | null
          error_message: string | null
          id: string
          order_id: string | null
          recipient: string
          sent_at: string | null
          status: string
          subject: string
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          id?: string
          order_id?: string | null
          recipient: string
          sent_at?: string | null
          status: string
          subject: string
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          id?: string
          order_id?: string | null
          recipient?: string
          sent_at?: string | null
          status?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_logs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_logs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          created_at: string | null
          created_by: string | null
          html_content: string
          id: string
          is_active: boolean | null
          name: string
          subject: string
          text_content: string
          type: string
          updated_at: string | null
          updated_by: string | null
          variables: Json | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          html_content: string
          id?: string
          is_active?: boolean | null
          name: string
          subject: string
          text_content: string
          type: string
          updated_at?: string | null
          updated_by?: string | null
          variables?: Json | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          html_content?: string
          id?: string
          is_active?: boolean | null
          name?: string
          subject?: string
          text_content?: string
          type?: string
          updated_at?: string | null
          updated_by?: string | null
          variables?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "email_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_templates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_access_log: {
        Row: {
          accessed_at: string | null
          action: string | null
          id: string
          ip_address: unknown
          metadata: Json | null
          table_accessed: string | null
          user_agent: string | null
          user_email: string | null
          user_id: string | null
          user_role: string | null
        }
        Insert: {
          accessed_at?: string | null
          action?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          table_accessed?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
          user_role?: string | null
        }
        Update: {
          accessed_at?: string | null
          action?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          table_accessed?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
          user_role?: string | null
        }
        Relationships: []
      }
      global_sourcing_import_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          cursor: Json
          error_details: Json | null
          error_message: string | null
          failed_at: string | null
          id: string
          payload: Json
          progress_current: number
          progress_stage: string | null
          progress_total: number
          provider: string
          requested_by: string | null
          result: Json | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          cursor?: Json
          error_details?: Json | null
          error_message?: string | null
          failed_at?: string | null
          id?: string
          payload: Json
          progress_current?: number
          progress_stage?: string | null
          progress_total?: number
          provider?: string
          requested_by?: string | null
          result?: Json | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          cursor?: Json
          error_details?: Json | null
          error_message?: string | null
          failed_at?: string | null
          id?: string
          payload?: Json
          progress_current?: number
          progress_stage?: string | null
          progress_total?: number
          provider?: string
          requested_by?: string | null
          result?: Json | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "global_sourcing_import_jobs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      global_sourcing_requests: {
        Row: {
          cj_pid: string | null
          cj_request_id: string | null
          cj_vid: string | null
          created_at: string
          error_message: string | null
          id: string
          metadata: Json
          note: string | null
          provider: string
          raw_request_payload: Json
          raw_response_payload: Json
          receiving_hub_id: string | null
          request_type: string
          requested_quantity: number | null
          resolved_product_title: string | null
          resolved_variant_title: string | null
          source_domain: string | null
          source_url: string
          status: string
          updated_at: string
          vendor_id: string | null
        }
        Insert: {
          cj_pid?: string | null
          cj_request_id?: string | null
          cj_vid?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          metadata?: Json
          note?: string | null
          provider?: string
          raw_request_payload?: Json
          raw_response_payload?: Json
          receiving_hub_id?: string | null
          request_type?: string
          requested_quantity?: number | null
          resolved_product_title?: string | null
          resolved_variant_title?: string | null
          source_domain?: string | null
          source_url: string
          status?: string
          updated_at?: string
          vendor_id?: string | null
        }
        Update: {
          cj_pid?: string | null
          cj_request_id?: string | null
          cj_vid?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          metadata?: Json
          note?: string | null
          provider?: string
          raw_request_payload?: Json
          raw_response_payload?: Json
          receiving_hub_id?: string | null
          request_type?: string
          requested_quantity?: number | null
          resolved_product_title?: string | null
          resolved_variant_title?: string | null
          source_domain?: string | null
          source_url?: string
          status?: string
          updated_at?: string
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "global_sourcing_requests_receiving_hub_id_fkey"
            columns: ["receiving_hub_id"]
            isOneToOne: false
            referencedRelation: "hub_performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "global_sourcing_requests_receiving_hub_id_fkey"
            columns: ["receiving_hub_id"]
            isOneToOne: false
            referencedRelation: "hubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "global_sourcing_requests_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_earnings_summary"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "global_sourcing_requests_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      global_sourcing_settings: {
        Row: {
          created_at: string
          default_import_buffer_usd: number | null
          default_markup_flat_ngn: number | null
          default_markup_percent: number | null
          default_usd_to_ngn_rate: number | null
          fx_cache_expires_at: string | null
          fx_last_fetched_at: string | null
          fx_last_fetched_rate: number | null
          fx_live_api_enabled: boolean
          fx_manual_override_enabled: boolean
          fx_manual_rate: number | null
          fx_manual_rate_note: string | null
          fx_provider: string
          metadata: Json
          provider: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_import_buffer_usd?: number | null
          default_markup_flat_ngn?: number | null
          default_markup_percent?: number | null
          default_usd_to_ngn_rate?: number | null
          fx_cache_expires_at?: string | null
          fx_last_fetched_at?: string | null
          fx_last_fetched_rate?: number | null
          fx_live_api_enabled?: boolean
          fx_manual_override_enabled?: boolean
          fx_manual_rate?: number | null
          fx_manual_rate_note?: string | null
          fx_provider?: string
          metadata?: Json
          provider: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_import_buffer_usd?: number | null
          default_markup_flat_ngn?: number | null
          default_markup_percent?: number | null
          default_usd_to_ngn_rate?: number | null
          fx_cache_expires_at?: string | null
          fx_last_fetched_at?: string | null
          fx_last_fetched_rate?: number | null
          fx_live_api_enabled?: boolean
          fx_manual_override_enabled?: boolean
          fx_manual_rate?: number | null
          fx_manual_rate_note?: string | null
          fx_provider?: string
          metadata?: Json
          provider?: string
          updated_at?: string
        }
        Relationships: []
      }
      homepage_content: {
        Row: {
          content: Json
          display_order: number
          id: string
          is_active: boolean
          key: string
          type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          content?: Json
          display_order?: number
          id?: string
          is_active?: boolean
          key: string
          type: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          content?: Json
          display_order?: number
          id?: string
          is_active?: boolean
          key?: string
          type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      hub_couriers: {
        Row: {
          courier_id: string | null
          created_at: string | null
          custom_base_rate: number | null
          hub_id: string | null
          id: string
          is_active: boolean | null
          is_primary: boolean | null
          priority: number | null
          updated_at: string | null
        }
        Insert: {
          courier_id?: string | null
          created_at?: string | null
          custom_base_rate?: number | null
          hub_id?: string | null
          id?: string
          is_active?: boolean | null
          is_primary?: boolean | null
          priority?: number | null
          updated_at?: string | null
        }
        Update: {
          courier_id?: string | null
          created_at?: string | null
          custom_base_rate?: number | null
          hub_id?: string | null
          id?: string
          is_active?: boolean | null
          is_primary?: boolean | null
          priority?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hub_couriers_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "courier_performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_couriers_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_couriers_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "pending_courier_payments"
            referencedColumns: ["courier_id"]
          },
          {
            foreignKeyName: "hub_couriers_hub_id_fkey"
            columns: ["hub_id"]
            isOneToOne: false
            referencedRelation: "hub_performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_couriers_hub_id_fkey"
            columns: ["hub_id"]
            isOneToOne: false
            referencedRelation: "hubs"
            referencedColumns: ["id"]
          },
        ]
      }
      hubs: {
        Row: {
          address: string
          can_ship_nationwide: boolean | null
          city: string
          code: string
          created_at: string | null
          email: string | null
          id: string
          is_active: boolean | null
          is_default: boolean | null
          latitude: number | null
          lga: string | null
          longitude: number | null
          manager_name: string | null
          manager_phone: string | null
          metadata: Json | null
          name: string
          operating_hours: Json | null
          phone: string | null
          preferred_courier_id: string | null
          state: string
          updated_at: string | null
        }
        Insert: {
          address: string
          can_ship_nationwide?: boolean | null
          city: string
          code: string
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          latitude?: number | null
          lga?: string | null
          longitude?: number | null
          manager_name?: string | null
          manager_phone?: string | null
          metadata?: Json | null
          name: string
          operating_hours?: Json | null
          phone?: string | null
          preferred_courier_id?: string | null
          state: string
          updated_at?: string | null
        }
        Update: {
          address?: string
          can_ship_nationwide?: boolean | null
          city?: string
          code?: string
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          latitude?: number | null
          lga?: string | null
          longitude?: number | null
          manager_name?: string | null
          manager_phone?: string | null
          metadata?: Json | null
          name?: string
          operating_hours?: Json | null
          phone?: string | null
          preferred_courier_id?: string | null
          state?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hubs_preferred_courier_id_fkey"
            columns: ["preferred_courier_id"]
            isOneToOne: false
            referencedRelation: "courier_performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hubs_preferred_courier_id_fkey"
            columns: ["preferred_courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hubs_preferred_courier_id_fkey"
            columns: ["preferred_courier_id"]
            isOneToOne: false
            referencedRelation: "pending_courier_payments"
            referencedColumns: ["courier_id"]
          },
        ]
      }
      influencer_payment_batches: {
        Row: {
          created_at: string | null
          id: string
          notes: string | null
          payment_method: string | null
          payment_reference: string | null
          payment_status: string | null
          period_end: string
          period_start: string
          processed_at: string | null
          processed_by: string | null
          total_commission: number
          total_influencers: number
          total_orders: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          notes?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          payment_status?: string | null
          period_end: string
          period_start: string
          processed_at?: string | null
          processed_by?: string | null
          total_commission: number
          total_influencers: number
          total_orders: number
        }
        Update: {
          created_at?: string | null
          id?: string
          notes?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          payment_status?: string | null
          period_end?: string
          period_start?: string
          processed_at?: string | null
          processed_by?: string | null
          total_commission?: number
          total_influencers?: number
          total_orders?: number
        }
        Relationships: []
      }
      influencer_sales: {
        Row: {
          admin_commission: number
          commission_status: string | null
          created_at: string | null
          customer_email: string | null
          id: string
          influencer_commission_amount: number
          influencer_commission_rate: number
          influencer_id: string
          notes: string | null
          order_number: string | null
          order_status: string | null
          payment_batch_id: string | null
          payment_date: string | null
          payment_reference: string | null
          product_total: number
          sale_date: string
          shipping_actual_cost: number
          shipping_customer_paid: number
          shipping_discount_amount: number
          shipping_original_cost: number
          updated_at: string | null
          vendor_amount: number
          wc_order_id: string
        }
        Insert: {
          admin_commission: number
          commission_status?: string | null
          created_at?: string | null
          customer_email?: string | null
          id?: string
          influencer_commission_amount: number
          influencer_commission_rate: number
          influencer_id: string
          notes?: string | null
          order_number?: string | null
          order_status?: string | null
          payment_batch_id?: string | null
          payment_date?: string | null
          payment_reference?: string | null
          product_total: number
          sale_date: string
          shipping_actual_cost: number
          shipping_customer_paid: number
          shipping_discount_amount: number
          shipping_original_cost: number
          updated_at?: string | null
          vendor_amount: number
          wc_order_id: string
        }
        Update: {
          admin_commission?: number
          commission_status?: string | null
          created_at?: string | null
          customer_email?: string | null
          id?: string
          influencer_commission_amount?: number
          influencer_commission_rate?: number
          influencer_id?: string
          notes?: string | null
          order_number?: string | null
          order_status?: string | null
          payment_batch_id?: string | null
          payment_date?: string | null
          payment_reference?: string | null
          product_total?: number
          sale_date?: string
          shipping_actual_cost?: number
          shipping_customer_paid?: number
          shipping_discount_amount?: number
          shipping_original_cost?: number
          updated_at?: string | null
          vendor_amount?: number
          wc_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "influencer_sales_influencer_id_fkey"
            columns: ["influencer_id"]
            isOneToOne: false
            referencedRelation: "influencers"
            referencedColumns: ["id"]
          },
        ]
      }
      influencers: {
        Row: {
          account_name: string | null
          account_number: string | null
          bank_name: string | null
          commission_based_on: string | null
          commission_rate: number | null
          coupon_code: string
          created_at: string | null
          created_by: string | null
          email: string | null
          handle: string | null
          id: string
          last_sale_date: string | null
          maximum_uses: number | null
          minimum_order_value: number | null
          name: string
          phone: string | null
          platform: string | null
          shipping_discount_type: string | null
          shipping_discount_value: number | null
          start_date: string | null
          status: string | null
          tier: string | null
          total_commission_earned: number | null
          total_commission_paid: number | null
          total_orders: number | null
          total_sales: number | null
          total_shipping_discounts: number | null
          updated_at: string | null
        }
        Insert: {
          account_name?: string | null
          account_number?: string | null
          bank_name?: string | null
          commission_based_on?: string | null
          commission_rate?: number | null
          coupon_code: string
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          handle?: string | null
          id?: string
          last_sale_date?: string | null
          maximum_uses?: number | null
          minimum_order_value?: number | null
          name: string
          phone?: string | null
          platform?: string | null
          shipping_discount_type?: string | null
          shipping_discount_value?: number | null
          start_date?: string | null
          status?: string | null
          tier?: string | null
          total_commission_earned?: number | null
          total_commission_paid?: number | null
          total_orders?: number | null
          total_sales?: number | null
          total_shipping_discounts?: number | null
          updated_at?: string | null
        }
        Update: {
          account_name?: string | null
          account_number?: string | null
          bank_name?: string | null
          commission_based_on?: string | null
          commission_rate?: number | null
          coupon_code?: string
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          handle?: string | null
          id?: string
          last_sale_date?: string | null
          maximum_uses?: number | null
          minimum_order_value?: number | null
          name?: string
          phone?: string | null
          platform?: string | null
          shipping_discount_type?: string | null
          shipping_discount_value?: number | null
          start_date?: string | null
          status?: string | null
          tier?: string | null
          total_commission_earned?: number | null
          total_commission_paid?: number | null
          total_orders?: number | null
          total_sales?: number | null
          total_shipping_discounts?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ledger_expenses: {
        Row: {
          amount: number
          category: string
          created_at: string | null
          created_by: string | null
          currency: string
          description: string | null
          fiscal_month: number | null
          fiscal_year: number | null
          id: string
          metadata: Json | null
          paid_at: string
          paid_to: string | null
          payment_method: string | null
          payment_reference: string | null
          source: string
          source_reference: string
          subcategory: string | null
          tax_deductible: boolean | null
          updated_at: string | null
          vat_amount: number | null
        }
        Insert: {
          amount: number
          category: string
          created_at?: string | null
          created_by?: string | null
          currency?: string
          description?: string | null
          fiscal_month?: number | null
          fiscal_year?: number | null
          id?: string
          metadata?: Json | null
          paid_at: string
          paid_to?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          source: string
          source_reference: string
          subcategory?: string | null
          tax_deductible?: boolean | null
          updated_at?: string | null
          vat_amount?: number | null
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string | null
          created_by?: string | null
          currency?: string
          description?: string | null
          fiscal_month?: number | null
          fiscal_year?: number | null
          id?: string
          metadata?: Json | null
          paid_at?: string
          paid_to?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          source?: string
          source_reference?: string
          subcategory?: string | null
          tax_deductible?: boolean | null
          updated_at?: string | null
          vat_amount?: number | null
        }
        Relationships: []
      }
      ledger_revenue: {
        Row: {
          amount: number
          commission_amount: number | null
          created_at: string | null
          currency: string
          description: string | null
          fiscal_month: number | null
          fiscal_year: number | null
          id: string
          metadata: Json | null
          order_id: string | null
          other_revenue: number | null
          platform_fee: number | null
          received_at: string
          shipping_margin: number | null
          source: string
          updated_at: string | null
          vat_amount: number | null
          vat_applicable: boolean | null
          vat_rate: number | null
        }
        Insert: {
          amount: number
          commission_amount?: number | null
          created_at?: string | null
          currency?: string
          description?: string | null
          fiscal_month?: number | null
          fiscal_year?: number | null
          id?: string
          metadata?: Json | null
          order_id?: string | null
          other_revenue?: number | null
          platform_fee?: number | null
          received_at: string
          shipping_margin?: number | null
          source: string
          updated_at?: string | null
          vat_amount?: number | null
          vat_applicable?: boolean | null
          vat_rate?: number | null
        }
        Update: {
          amount?: number
          commission_amount?: number | null
          created_at?: string | null
          currency?: string
          description?: string | null
          fiscal_month?: number | null
          fiscal_year?: number | null
          id?: string
          metadata?: Json | null
          order_id?: string | null
          other_revenue?: number | null
          platform_fee?: number | null
          received_at?: string
          shipping_margin?: number | null
          source?: string
          updated_at?: string | null
          vat_amount?: number | null
          vat_applicable?: boolean | null
          vat_rate?: number | null
        }
        Relationships: []
      }
      ledger_vat: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          metadata: Json | null
          net_vat: number | null
          period_end: string
          period_month: string
          period_start: string
          reference_id: string | null
          source: string
          vat_collected: number | null
          vat_payable: number | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          metadata?: Json | null
          net_vat?: number | null
          period_end: string
          period_month: string
          period_start: string
          reference_id?: string | null
          source: string
          vat_collected?: number | null
          vat_payable?: number | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          metadata?: Json | null
          net_vat?: number | null
          period_end?: string
          period_month?: string
          period_start?: string
          reference_id?: string | null
          source?: string
          vat_collected?: number | null
          vat_payable?: number | null
        }
        Relationships: []
      }
      meta_action_logs: {
        Row: {
          id: string
          user_id: string | null
          action: string
          resource: string | null
          resource_id: string | null
          details: Json | null
          status: string
          error_msg: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          action: string
          resource?: string | null
          resource_id?: string | null
          details?: Json | null
          status?: string
          error_msg?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          action?: string
          resource?: string | null
          resource_id?: string | null
          details?: Json | null
          status?: string
          error_msg?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_action_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_ad_drafts: {
        Row: {
          id: string
          title: string
          headline: string | null
          body_text: string
          call_to_action: string
          image_url: string | null
          destination_url: string | null
          source_products: Json | null
          source_context: Json | null
          target_audience: Json | null
          suggested_budget: number | null
          status: string
          ai_generated: boolean
          created_by: string | null
          approved_by: string | null
          approved_at: string | null
          rejection_note: string | null
          published_at: string | null
          meta_ad_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          title: string
          headline?: string | null
          body_text: string
          call_to_action?: string
          image_url?: string | null
          destination_url?: string | null
          source_products?: Json | null
          source_context?: Json | null
          target_audience?: Json | null
          suggested_budget?: number | null
          status?: string
          ai_generated?: boolean
          created_by?: string | null
          approved_by?: string | null
          approved_at?: string | null
          rejection_note?: string | null
          published_at?: string | null
          meta_ad_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          title?: string
          headline?: string | null
          body_text?: string
          call_to_action?: string
          image_url?: string | null
          destination_url?: string | null
          source_products?: Json | null
          source_context?: Json | null
          target_audience?: Json | null
          suggested_budget?: number | null
          status?: string
          ai_generated?: boolean
          created_by?: string | null
          approved_by?: string | null
          approved_at?: string | null
          rejection_note?: string | null
          published_at?: string | null
          meta_ad_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_ad_drafts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_ad_drafts_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_ai_recommendations: {
        Row: {
          id: string
          type: string
          priority: string
          title: string
          description: string
          action_data: Json | null
          source_data: Json | null
          campaign_id: string | null
          status: string
          actioned_by: string | null
          actioned_at: string | null
          expires_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          type: string
          priority?: string
          title: string
          description: string
          action_data?: Json | null
          source_data?: Json | null
          campaign_id?: string | null
          status?: string
          actioned_by?: string | null
          actioned_at?: string | null
          expires_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          type?: string
          priority?: string
          title?: string
          description?: string
          action_data?: Json | null
          source_data?: Json | null
          campaign_id?: string | null
          status?: string
          actioned_by?: string | null
          actioned_at?: string | null
          expires_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_ai_recommendations_actioned_by_fkey"
            columns: ["actioned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_campaigns_cache: {
        Row: {
          id: string
          meta_campaign_id: string
          name: string
          status: string
          objective: string | null
          daily_budget: number | null
          lifetime_budget: number | null
          spend_cap: number | null
          start_time: string | null
          stop_time: string | null
          impressions: number
          reach: number
          clicks: number
          spend: number
          ctr: number
          cpc: number
          cpm: number
          ad_account_id: string
          synced_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          meta_campaign_id: string
          name: string
          status: string
          objective?: string | null
          daily_budget?: number | null
          lifetime_budget?: number | null
          spend_cap?: number | null
          start_time?: string | null
          stop_time?: string | null
          impressions?: number
          reach?: number
          clicks?: number
          spend?: number
          ctr?: number
          cpc?: number
          cpm?: number
          ad_account_id: string
          synced_at?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          meta_campaign_id?: string
          name?: string
          status?: string
          objective?: string | null
          daily_budget?: number | null
          lifetime_budget?: number | null
          spend_cap?: number | null
          start_time?: string | null
          stop_time?: string | null
          impressions?: number
          reach?: number
          clicks?: number
          spend?: number
          ctr?: number
          cpc?: number
          cpm?: number
          ad_account_id?: string
          synced_at?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      manual_supplier_order_items: {
        Row: {
          cj_inbound_shipment_id: string | null
          cj_pid: string | null
          cj_vid: string | null
          created_at: string
          id: string
          manual_supplier_order_id: string
          order_id: string | null
          product_id: string | null
          quantity: number
          sub_order_id: string | null
          variation_id: string | null
        }
        Insert: {
          cj_inbound_shipment_id?: string | null
          cj_pid?: string | null
          cj_vid?: string | null
          created_at?: string
          id?: string
          manual_supplier_order_id: string
          order_id?: string | null
          product_id?: string | null
          quantity?: number
          sub_order_id?: string | null
          variation_id?: string | null
        }
        Update: {
          cj_inbound_shipment_id?: string | null
          cj_pid?: string | null
          cj_vid?: string | null
          created_at?: string
          id?: string
          manual_supplier_order_id?: string
          order_id?: string | null
          product_id?: string | null
          quantity?: number
          sub_order_id?: string | null
          variation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manual_supplier_order_items_cj_inbound_shipment_id_fkey"
            columns: ["cj_inbound_shipment_id"]
            isOneToOne: false
            referencedRelation: "cj_inbound_shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_supplier_order_items_manual_supplier_order_id_fkey"
            columns: ["manual_supplier_order_id"]
            isOneToOne: false
            referencedRelation: "manual_supplier_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_supplier_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_supplier_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_supplier_order_items_sub_order_id_fkey"
            columns: ["sub_order_id"]
            isOneToOne: false
            referencedRelation: "sub_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_supplier_orders: {
        Row: {
          cj_order_id: string | null
          created_at: string
          id: string
          metadata: Json
          notes: string | null
          ordered_at: string | null
          provider: string
          status: string
          supplier_order_mode: string
          updated_at: string
        }
        Insert: {
          cj_order_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          notes?: string | null
          ordered_at?: string | null
          provider?: string
          status?: string
          supplier_order_mode?: string
          updated_at?: string
        }
        Update: {
          cj_order_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          notes?: string | null
          ordered_at?: string | null
          provider?: string
          status?: string
          supplier_order_mode?: string
          updated_at?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          created_at: string | null
          hub_id: string | null
          id: string
          metadata: Json | null
          order_id: string | null
          product_id: string
          product_name: string
          product_sku: string | null
          quantity: number
          sub_order_id: string | null
          subtotal: number
          tax: number | null
          unit_price: number
          variation_details: Json | null
          variation_id: string | null
          vendor_id: string | null
        }
        Insert: {
          created_at?: string | null
          hub_id?: string | null
          id?: string
          metadata?: Json | null
          order_id?: string | null
          product_id: string
          product_name: string
          product_sku?: string | null
          quantity: number
          sub_order_id?: string | null
          subtotal: number
          tax?: number | null
          unit_price: number
          variation_details?: Json | null
          variation_id?: string | null
          vendor_id?: string | null
        }
        Update: {
          created_at?: string | null
          hub_id?: string | null
          id?: string
          metadata?: Json | null
          order_id?: string | null
          product_id?: string
          product_name?: string
          product_sku?: string | null
          quantity?: number
          sub_order_id?: string | null
          subtotal?: number
          tax?: number | null
          unit_price?: number
          variation_details?: Json | null
          variation_id?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_hub_id_fkey"
            columns: ["hub_id"]
            isOneToOne: false
            referencedRelation: "hub_performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_hub_id_fkey"
            columns: ["hub_id"]
            isOneToOne: false
            referencedRelation: "hubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_sub_order_id_fkey"
            columns: ["sub_order_id"]
            isOneToOne: false
            referencedRelation: "sub_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_earnings_summary"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "order_items_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string | null
          customer_email: string
          customer_name: string
          customer_phone: string
          delivery_address: string
          delivery_city: string
          delivery_landmark: string | null
          delivery_lga: string | null
          delivery_state: string
          delivery_zone: string
          discount_amount: number | null
          email_notifications_enabled: boolean | null
          id: string
          metadata: Json | null
          order_notes: string | null
          order_number: number
          overall_status: Database["public"]["Enums"]["order_status"] | null
          paid_at: string | null
          payment_method: string | null
          payment_reference: string | null
          payment_status: Database["public"]["Enums"]["payment_status"] | null
          shipping_fee_paid: number
          special_instructions: string | null
          subtotal: number
          tax_amount: number | null
          total_amount: number
          updated_at: string | null
          woocommerce_order_id: string | null
        }
        Insert: {
          created_at?: string | null
          customer_email: string
          customer_name: string
          customer_phone: string
          delivery_address: string
          delivery_city: string
          delivery_landmark?: string | null
          delivery_lga?: string | null
          delivery_state: string
          delivery_zone: string
          discount_amount?: number | null
          email_notifications_enabled?: boolean | null
          id?: string
          metadata?: Json | null
          order_notes?: string | null
          order_number: number
          overall_status?: Database["public"]["Enums"]["order_status"] | null
          paid_at?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"] | null
          shipping_fee_paid: number
          special_instructions?: string | null
          subtotal: number
          tax_amount?: number | null
          total_amount: number
          updated_at?: string | null
          woocommerce_order_id?: string | null
        }
        Update: {
          created_at?: string | null
          customer_email?: string
          customer_name?: string
          customer_phone?: string
          delivery_address?: string
          delivery_city?: string
          delivery_landmark?: string | null
          delivery_lga?: string | null
          delivery_state?: string
          delivery_zone?: string
          discount_amount?: number | null
          email_notifications_enabled?: boolean | null
          id?: string
          metadata?: Json | null
          order_notes?: string | null
          order_number?: number
          overall_status?: Database["public"]["Enums"]["order_status"] | null
          paid_at?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"] | null
          shipping_fee_paid?: number
          special_instructions?: string | null
          subtotal?: number
          tax_amount?: number | null
          total_amount?: number
          updated_at?: string | null
          woocommerce_order_id?: string | null
        }
        Relationships: []
      }
      permissions: {
        Row: {
          actions: string[]
          created_at: string | null
          description: string | null
          display_name: string
          id: string
          name: string
          resource: string
        }
        Insert: {
          actions: string[]
          created_at?: string | null
          description?: string | null
          display_name: string
          id?: string
          name: string
          resource: string
        }
        Update: {
          actions?: string[]
          created_at?: string | null
          description?: string | null
          display_name?: string
          id?: string
          name?: string
          resource?: string
        }
        Relationships: []
      }
      product_attribute_map: {
        Row: {
          attribute_id: string
          display_order: number | null
          id: string
          is_variation: boolean
          options: Json
          product_id: string
        }
        Insert: {
          attribute_id: string
          display_order?: number | null
          id?: string
          is_variation?: boolean
          options?: Json
          product_id: string
        }
        Update: {
          attribute_id?: string
          display_order?: number | null
          id?: string
          is_variation?: boolean
          options?: Json
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_attribute_map_attribute_id_fkey"
            columns: ["attribute_id"]
            isOneToOne: false
            referencedRelation: "product_attributes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_attribute_map_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_attribute_options: {
        Row: {
          attribute_id: string
          id: string
          slug: string
          value: string
        }
        Insert: {
          attribute_id: string
          id?: string
          slug: string
          value: string
        }
        Update: {
          attribute_id?: string
          id?: string
          slug?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_attribute_options_attribute_id_fkey"
            columns: ["attribute_id"]
            isOneToOne: false
            referencedRelation: "product_attributes"
            referencedColumns: ["id"]
          },
        ]
      }
      product_attributes: {
        Row: {
          display_order: number | null
          id: string
          name: string
          slug: string
          type: string
        }
        Insert: {
          display_order?: number | null
          id?: string
          name: string
          slug: string
          type?: string
        }
        Update: {
          display_order?: number | null
          id?: string
          name?: string
          slug?: string
          type?: string
        }
        Relationships: []
      }
      product_category_map: {
        Row: {
          category_id: string
          product_id: string
        }
        Insert: {
          category_id: string
          product_id: string
        }
        Update: {
          category_id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_category_map_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_category_map_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_images: {
        Row: {
          alt: string | null
          id: string
          is_thumbnail: boolean
          position: number
          product_id: string
          src: string
          variation_id: string | null
        }
        Insert: {
          alt?: string | null
          id?: string
          is_thumbnail?: boolean
          position?: number
          product_id: string
          src: string
          variation_id?: string | null
        }
        Update: {
          alt?: string | null
          id?: string
          is_thumbnail?: boolean
          position?: number
          product_id?: string
          src?: string
          variation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_variation_id_fkey"
            columns: ["variation_id"]
            isOneToOne: false
            referencedRelation: "product_variations"
            referencedColumns: ["id"]
          },
        ]
      }
      product_tag_map: {
        Row: {
          product_id: string
          tag_id: string
        }
        Insert: {
          product_id: string
          tag_id: string
        }
        Update: {
          product_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_tag_map_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_tag_map_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variations: {
        Row: {
          attributes: Json
          created_at: string
          hub_id: string | null
          id: string
          is_active: boolean
          manage_stock: boolean
          product_id: string
          regular_price: number | null
          sale_price: number | null
          sku: string | null
          sourcing_meta: Json | null
          stock_quantity: number | null
          stock_status: Database["public"]["Enums"]["stock_status_type"]
          updated_at: string
          vendor_id: string | null
          woo_variation_id: number | null
        }
        Insert: {
          attributes?: Json
          created_at?: string
          hub_id?: string | null
          id?: string
          is_active?: boolean
          manage_stock?: boolean
          product_id: string
          regular_price?: number | null
          sale_price?: number | null
          sku?: string | null
          sourcing_meta?: Json | null
          stock_quantity?: number | null
          stock_status?: Database["public"]["Enums"]["stock_status_type"]
          updated_at?: string
          vendor_id?: string | null
          woo_variation_id?: number | null
        }
        Update: {
          attributes?: Json
          created_at?: string
          hub_id?: string | null
          id?: string
          is_active?: boolean
          manage_stock?: boolean
          product_id?: string
          regular_price?: number | null
          sale_price?: number | null
          sku?: string | null
          sourcing_meta?: Json | null
          stock_quantity?: number | null
          stock_status?: Database["public"]["Enums"]["stock_status_type"]
          updated_at?: string
          vendor_id?: string | null
          woo_variation_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variations_hub_id_fkey"
            columns: ["hub_id"]
            isOneToOne: false
            referencedRelation: "hub_performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variations_hub_id_fkey"
            columns: ["hub_id"]
            isOneToOne: false
            referencedRelation: "hubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variations_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_earnings_summary"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "product_variations_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          created_at: string
          description: string | null
          height: number | null
          hub_id: string | null
          id: string
          is_downloadable: boolean
          is_virtual: boolean
          length: number | null
          manage_stock: boolean
          name: string
          regular_price: number | null
          sale_price: number | null
          seo_description: string | null
          seo_title: string | null
          ships_from_abroad: boolean
          short_description: string | null
          sku: string | null
          slug: string
          sold_individually: boolean
          sourcing_meta: Json | null
          status: Database["public"]["Enums"]["product_status"]
          stock_quantity: number | null
          stock_status: Database["public"]["Enums"]["stock_status_type"]
          type: Database["public"]["Enums"]["product_type"]
          updated_at: string
          vendor_id: string | null
          weight: number | null
          width: number | null
          woo_product_id: number | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          height?: number | null
          hub_id?: string | null
          id?: string
          is_downloadable?: boolean
          is_virtual?: boolean
          length?: number | null
          manage_stock?: boolean
          name: string
          regular_price?: number | null
          sale_price?: number | null
          seo_description?: string | null
          seo_title?: string | null
          ships_from_abroad?: boolean
          short_description?: string | null
          sku?: string | null
          slug: string
          sold_individually?: boolean
          sourcing_meta?: Json | null
          status?: Database["public"]["Enums"]["product_status"]
          stock_quantity?: number | null
          stock_status?: Database["public"]["Enums"]["stock_status_type"]
          type?: Database["public"]["Enums"]["product_type"]
          updated_at?: string
          vendor_id?: string | null
          weight?: number | null
          width?: number | null
          woo_product_id?: number | null
        }
        Update: {
          created_at?: string
          description?: string | null
          height?: number | null
          hub_id?: string | null
          id?: string
          is_downloadable?: boolean
          is_virtual?: boolean
          length?: number | null
          manage_stock?: boolean
          name?: string
          regular_price?: number | null
          sale_price?: number | null
          seo_description?: string | null
          seo_title?: string | null
          ships_from_abroad?: boolean
          short_description?: string | null
          sku?: string | null
          slug?: string
          sold_individually?: boolean
          sourcing_meta?: Json | null
          status?: Database["public"]["Enums"]["product_status"]
          stock_quantity?: number | null
          stock_status?: Database["public"]["Enums"]["stock_status_type"]
          type?: Database["public"]["Enums"]["product_type"]
          updated_at?: string
          vendor_id?: string | null
          weight?: number | null
          width?: number | null
          woo_product_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_hub_id_fkey"
            columns: ["hub_id"]
            isOneToOne: false
            referencedRelation: "hub_performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_hub_id_fkey"
            columns: ["hub_id"]
            isOneToOne: false
            referencedRelation: "hubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_earnings_summary"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "products_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_auth_tokens: {
        Row: {
          access_token: string
          created_at: string
          expires_at: string
          metadata: Json
          provider: string
          updated_at: string
        }
        Insert: {
          access_token: string
          created_at?: string
          expires_at: string
          metadata?: Json
          provider: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          created_at?: string
          expires_at?: string
          metadata?: Json
          provider?: string
          updated_at?: string
        }
        Relationships: []
      }
      rate_history: {
        Row: {
          change_reason: string | null
          changed_by: string | null
          courier_id: string | null
          created_at: string | null
          id: string
          new_rate: number | null
          old_rate: number | null
          zone_id: string | null
        }
        Insert: {
          change_reason?: string | null
          changed_by?: string | null
          courier_id?: string | null
          created_at?: string | null
          id?: string
          new_rate?: number | null
          old_rate?: number | null
          zone_id?: string | null
        }
        Update: {
          change_reason?: string | null
          changed_by?: string | null
          courier_id?: string | null
          created_at?: string | null
          id?: string
          new_rate?: number | null
          old_rate?: number | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rate_history_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "courier_performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rate_history_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rate_history_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "pending_courier_payments"
            referencedColumns: ["courier_id"]
          },
          {
            foreignKeyName: "rate_history_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      refund_records: {
        Row: {
          amount: number
          completed_at: string | null
          created_at: string
          currency: string
          id: string
          initiated_by: string | null
          order_id: string
          paystack_raw: Json | null
          paystack_refund_id: string | null
          paystack_status: string | null
          paystack_transaction_ref: string | null
          reason: string | null
          return_request_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          completed_at?: string | null
          created_at?: string
          currency?: string
          id?: string
          initiated_by?: string | null
          order_id: string
          paystack_raw?: Json | null
          paystack_refund_id?: string | null
          paystack_status?: string | null
          paystack_transaction_ref?: string | null
          reason?: string | null
          return_request_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          completed_at?: string | null
          created_at?: string
          currency?: string
          id?: string
          initiated_by?: string | null
          order_id?: string
          paystack_raw?: Json | null
          paystack_refund_id?: string | null
          paystack_status?: string | null
          paystack_transaction_ref?: string | null
          reason?: string | null
          return_request_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refund_records_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_records_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_records_return_request_id_fkey"
            columns: ["return_request_id"]
            isOneToOne: false
            referencedRelation: "return_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      pwa_install_events: {
        Row: {
          id: string
          event_name: string
          platform: string | null
          is_standalone: boolean | null
          customer_id: string | null
          anonymous_id: string | null
          user_agent: string | null
          source_page: string | null
          metadata: Json | null
          created_at: string | null
        }
        Insert: {
          id?: string
          event_name: string
          platform?: string | null
          is_standalone?: boolean | null
          customer_id?: string | null
          anonymous_id?: string | null
          user_agent?: string | null
          source_page?: string | null
          metadata?: Json | null
          created_at?: string | null
        }
        Update: {
          id?: string
          event_name?: string
          platform?: string | null
          is_standalone?: boolean | null
          customer_id?: string | null
          anonymous_id?: string | null
          user_agent?: string | null
          source_page?: string | null
          metadata?: Json | null
          created_at?: string | null
        }
        Relationships: []
      }
      return_requests: {
        Row: {
          created_at: string | null
          customer_email: string | null
          customer_name: string | null
          fez_method: string | null
          fez_shipment_id: string | null
          fez_tracking: string | null
          hub_id: string | null
          id: string
          images: Json | null
          inspected_at: string | null
          inspection_notes: string | null
          inspection_result: string | null
          order_id: number | null
          order_number: string | null
          preferred_resolution: string | null
          reason: string | null
          reason_code: string | null
          reason_note: string | null
          refund_amount: number | null
          refund_completed_at: string | null
          refund_currency: string | null
          refund_method: string | null
          refund_raw: Json | null
          refund_status: string | null
          refund_wc_id: string | null
          status: string | null
          supabase_order_id: string | null
          updated_at: string | null
          wc_customer_id: number | null
        }
        Insert: {
          created_at?: string | null
          customer_email?: string | null
          customer_name?: string | null
          fez_method?: string | null
          fez_shipment_id?: string | null
          fez_tracking?: string | null
          hub_id?: string | null
          id?: string
          images?: Json | null
          inspected_at?: string | null
          inspection_notes?: string | null
          inspection_result?: string | null
          order_id?: number | null
          order_number?: string | null
          preferred_resolution?: string | null
          reason?: string | null
          reason_code?: string | null
          reason_note?: string | null
          refund_amount?: number | null
          refund_completed_at?: string | null
          refund_currency?: string | null
          refund_method?: string | null
          refund_raw?: Json | null
          refund_status?: string | null
          refund_wc_id?: string | null
          status?: string | null
          supabase_order_id?: string | null
          updated_at?: string | null
          wc_customer_id?: number | null
        }
        Update: {
          created_at?: string | null
          customer_email?: string | null
          customer_name?: string | null
          fez_method?: string | null
          fez_shipment_id?: string | null
          fez_tracking?: string | null
          hub_id?: string | null
          id?: string
          images?: Json | null
          inspected_at?: string | null
          inspection_notes?: string | null
          inspection_result?: string | null
          order_id?: number | null
          order_number?: string | null
          preferred_resolution?: string | null
          reason?: string | null
          reason_code?: string | null
          reason_note?: string | null
          refund_amount?: number | null
          refund_completed_at?: string | null
          refund_currency?: string | null
          refund_method?: string | null
          refund_raw?: Json | null
          refund_status?: string | null
          refund_wc_id?: string | null
          status?: string | null
          supabase_order_id?: string | null
          updated_at?: string | null
          wc_customer_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "return_requests_supabase_order_id_fkey"
            columns: ["supabase_order_id"]
            isOneToOne: false
            referencedRelation: "order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_requests_supabase_order_id_fkey"
            columns: ["supabase_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      return_shipments: {
        Row: {
          created_at: string | null
          customer_submitted_tracking: boolean | null
          fez_shipment_id: string | null
          fez_tracking: string | null
          id: string
          method: string | null
          raw_payload: Json | null
          return_code: string | null
          return_request_id: string | null
          status: string | null
          tracking_submitted_at: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          customer_submitted_tracking?: boolean | null
          fez_shipment_id?: string | null
          fez_tracking?: string | null
          id?: string
          method?: string | null
          raw_payload?: Json | null
          return_code?: string | null
          return_request_id?: string | null
          status?: string | null
          tracking_submitted_at?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          customer_submitted_tracking?: boolean | null
          fez_shipment_id?: string | null
          fez_tracking?: string | null
          id?: string
          method?: string | null
          raw_payload?: Json | null
          return_code?: string | null
          return_request_id?: string | null
          status?: string | null
          tracking_submitted_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "return_shipments_return_request_id_fkey"
            columns: ["return_request_id"]
            isOneToOne: false
            referencedRelation: "return_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string | null
          description: string | null
          display_name: string
          id: string
          name: string
          permissions: Json | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          display_name: string
          id?: string
          name: string
          permissions?: Json | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          display_name?: string
          id?: string
          name?: string
          permissions?: Json | null
        }
        Relationships: []
      }
      settlement_items: {
        Row: {
          amount: number
          created_at: string | null
          id: string
          settlement_id: string | null
          sub_order_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          id?: string
          settlement_id?: string | null
          sub_order_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          id?: string
          settlement_id?: string | null
          sub_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "settlement_items_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "courier_settlement_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_items_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "courier_settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_items_sub_order_id_fkey"
            columns: ["sub_order_id"]
            isOneToOne: false
            referencedRelation: "sub_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_discounts: {
        Row: {
          created_at: string | null
          discount_value: number | null
          end_date: string | null
          id: string
          is_active: boolean | null
          min_order_value: number | null
          name: string
          start_date: string | null
          states: string[] | null
          type: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          discount_value?: number | null
          end_date?: string | null
          id?: string
          is_active?: boolean | null
          min_order_value?: number | null
          name: string
          start_date?: string | null
          states?: string[] | null
          type: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          discount_value?: number | null
          end_date?: string | null
          id?: string
          is_active?: boolean | null
          min_order_value?: number | null
          name?: string
          start_date?: string | null
          states?: string[] | null
          type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      shipping_rates: {
        Row: {
          courier_id: string | null
          created_at: string | null
          effective_from: string | null
          effective_to: string | null
          flat_rate: number
          free_shipping_threshold: number | null
          hub_id: string | null
          id: string
          is_active: boolean | null
          max_order_value: number | null
          max_weight_kg: number | null
          metadata: Json | null
          min_order_value: number | null
          min_weight_kg: number | null
          per_kg_rate: number | null
          priority: number | null
          updated_at: string | null
          zone_id: string | null
        }
        Insert: {
          courier_id?: string | null
          created_at?: string | null
          effective_from?: string | null
          effective_to?: string | null
          flat_rate: number
          free_shipping_threshold?: number | null
          hub_id?: string | null
          id?: string
          is_active?: boolean | null
          max_order_value?: number | null
          max_weight_kg?: number | null
          metadata?: Json | null
          min_order_value?: number | null
          min_weight_kg?: number | null
          per_kg_rate?: number | null
          priority?: number | null
          updated_at?: string | null
          zone_id?: string | null
        }
        Update: {
          courier_id?: string | null
          created_at?: string | null
          effective_from?: string | null
          effective_to?: string | null
          flat_rate?: number
          free_shipping_threshold?: number | null
          hub_id?: string | null
          id?: string
          is_active?: boolean | null
          max_order_value?: number | null
          max_weight_kg?: number | null
          metadata?: Json | null
          min_order_value?: number | null
          min_weight_kg?: number | null
          per_kg_rate?: number | null
          priority?: number | null
          updated_at?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipping_rates_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "courier_performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_rates_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_rates_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "pending_courier_payments"
            referencedColumns: ["courier_id"]
          },
          {
            foreignKeyName: "shipping_rates_hub_id_fkey"
            columns: ["hub_id"]
            isOneToOne: false
            referencedRelation: "hub_performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_rates_hub_id_fkey"
            columns: ["hub_id"]
            isOneToOne: false
            referencedRelation: "hubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_rates_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      sub_orders: {
        Row: {
          allocated_shipping_fee: number | null
          courier_charge: number | null
          courier_id: string | null
          courier_notes: string | null
          courier_paid_amount: number | null
          courier_shipment_id: string | null
          courier_tracking_url: string | null
          courier_waybill: string | null
          created_at: string | null
          delivered_at: string | null
          delivery_person_name: string | null
          delivery_person_phone: string | null
          delivery_person_vehicle: string | null
          delivery_proof_url: string | null
          estimated_shipping_cost: number | null
          failed_at: string | null
          hub_id: string | null
          hub_notes: string | null
          id: string
          in_transit_at: string | null
          items: Json
          label_url: string | null
          last_tracking_update: string | null
          main_order_id: string | null
          metadata: Json | null
          out_for_delivery_at: string | null
          payment_reference: string | null
          picked_up_at: string | null
          pickup_scheduled_at: string | null
          real_shipping_cost: number | null
          rider_name: string | null
          rider_phone: string | null
          settlement_date: string | null
          settlement_status: string | null
          status: Database["public"]["Enums"]["delivery_status"] | null
          subtotal: number
          tracking_number: string | null
          updated_at: string | null
          vendor_id: string | null
          waybill_url: string | null
        }
        Insert: {
          allocated_shipping_fee?: number | null
          courier_charge?: number | null
          courier_id?: string | null
          courier_notes?: string | null
          courier_paid_amount?: number | null
          courier_shipment_id?: string | null
          courier_tracking_url?: string | null
          courier_waybill?: string | null
          created_at?: string | null
          delivered_at?: string | null
          delivery_person_name?: string | null
          delivery_person_phone?: string | null
          delivery_person_vehicle?: string | null
          delivery_proof_url?: string | null
          estimated_shipping_cost?: number | null
          failed_at?: string | null
          hub_id?: string | null
          hub_notes?: string | null
          id?: string
          in_transit_at?: string | null
          items: Json
          label_url?: string | null
          last_tracking_update?: string | null
          main_order_id?: string | null
          metadata?: Json | null
          out_for_delivery_at?: string | null
          payment_reference?: string | null
          picked_up_at?: string | null
          pickup_scheduled_at?: string | null
          real_shipping_cost?: number | null
          rider_name?: string | null
          rider_phone?: string | null
          settlement_date?: string | null
          settlement_status?: string | null
          status?: Database["public"]["Enums"]["delivery_status"] | null
          subtotal: number
          tracking_number?: string | null
          updated_at?: string | null
          vendor_id?: string | null
          waybill_url?: string | null
        }
        Update: {
          allocated_shipping_fee?: number | null
          courier_charge?: number | null
          courier_id?: string | null
          courier_notes?: string | null
          courier_paid_amount?: number | null
          courier_shipment_id?: string | null
          courier_tracking_url?: string | null
          courier_waybill?: string | null
          created_at?: string | null
          delivered_at?: string | null
          delivery_person_name?: string | null
          delivery_person_phone?: string | null
          delivery_person_vehicle?: string | null
          delivery_proof_url?: string | null
          estimated_shipping_cost?: number | null
          failed_at?: string | null
          hub_id?: string | null
          hub_notes?: string | null
          id?: string
          in_transit_at?: string | null
          items?: Json
          label_url?: string | null
          last_tracking_update?: string | null
          main_order_id?: string | null
          metadata?: Json | null
          out_for_delivery_at?: string | null
          payment_reference?: string | null
          picked_up_at?: string | null
          pickup_scheduled_at?: string | null
          real_shipping_cost?: number | null
          rider_name?: string | null
          rider_phone?: string | null
          settlement_date?: string | null
          settlement_status?: string | null
          status?: Database["public"]["Enums"]["delivery_status"] | null
          subtotal?: number
          tracking_number?: string | null
          updated_at?: string | null
          vendor_id?: string | null
          waybill_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sub_orders_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "courier_performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_orders_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_orders_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "pending_courier_payments"
            referencedColumns: ["courier_id"]
          },
          {
            foreignKeyName: "sub_orders_hub_id_fkey"
            columns: ["hub_id"]
            isOneToOne: false
            referencedRelation: "hub_performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_orders_hub_id_fkey"
            columns: ["hub_id"]
            isOneToOne: false
            referencedRelation: "hubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_orders_main_order_id_fkey"
            columns: ["main_order_id"]
            isOneToOne: false
            referencedRelation: "order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_orders_main_order_id_fkey"
            columns: ["main_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_orders_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_earnings_summary"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "sub_orders_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          woo_term_id: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          woo_term_id?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          woo_term_id?: number | null
        }
        Relationships: []
      }
      tracking_events: {
        Row: {
          actor_name: string | null
          actor_type: string | null
          created_at: string | null
          description: string | null
          event_time: string
          id: string
          latitude: number | null
          location_city: string | null
          location_name: string | null
          location_state: string | null
          longitude: number | null
          metadata: Json | null
          remarks: string | null
          source: string | null
          source_reference: string | null
          status: Database["public"]["Enums"]["delivery_status"]
          sub_order_id: string | null
        }
        Insert: {
          actor_name?: string | null
          actor_type?: string | null
          created_at?: string | null
          description?: string | null
          event_time?: string
          id?: string
          latitude?: number | null
          location_city?: string | null
          location_name?: string | null
          location_state?: string | null
          longitude?: number | null
          metadata?: Json | null
          remarks?: string | null
          source?: string | null
          source_reference?: string | null
          status: Database["public"]["Enums"]["delivery_status"]
          sub_order_id?: string | null
        }
        Update: {
          actor_name?: string | null
          actor_type?: string | null
          created_at?: string | null
          description?: string | null
          event_time?: string
          id?: string
          latitude?: number | null
          location_city?: string | null
          location_name?: string | null
          location_state?: string | null
          longitude?: number | null
          metadata?: Json | null
          remarks?: string | null
          source?: string | null
          source_reference?: string | null
          status?: Database["public"]["Enums"]["delivery_status"]
          sub_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tracking_events_sub_order_id_fkey"
            columns: ["sub_order_id"]
            isOneToOne: false
            referencedRelation: "sub_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          catalog_access: boolean
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string
          is_active: boolean | null
          last_login: string | null
          metadata: Json | null
          role: string | null
          updated_at: string | null
        }
        Insert: {
          catalog_access?: boolean
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean | null
          last_login?: string | null
          metadata?: Json | null
          role?: string | null
          updated_at?: string | null
        }
        Update: {
          catalog_access?: boolean
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean | null
          last_login?: string | null
          metadata?: Json | null
          role?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      vendor_applications: {
        Row: {
          bank_account_name: string | null
          bank_account_number: string | null
          bank_name: string | null
          business_address: string | null
          business_type: string | null
          cac_document_url: string | null
          city: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          id_document_url: string | null
          nin_bvn: string | null
          phone: string
          rc_number: string | null
          reject_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          state: string | null
          status: string
          store_name: string
          updated_at: string
          vendor_id: string | null
        }
        Insert: {
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          business_address?: string | null
          business_type?: string | null
          cac_document_url?: string | null
          city?: string | null
          created_at?: string
          email: string
          full_name: string
          id?: string
          id_document_url?: string | null
          nin_bvn?: string | null
          phone: string
          rc_number?: string | null
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          state?: string | null
          status?: string
          store_name: string
          updated_at?: string
          vendor_id?: string | null
        }
        Update: {
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          business_address?: string | null
          business_type?: string | null
          cac_document_url?: string | null
          city?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          id_document_url?: string | null
          nin_bvn?: string | null
          phone?: string
          rc_number?: string | null
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          state?: string | null
          status?: string
          store_name?: string
          updated_at?: string
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_applications_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_earnings_summary"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "vendor_applications_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_withdrawals: {
        Row: {
          amount: number
          approved_by: string | null
          bank_account_name: string | null
          bank_account_number: string | null
          bank_name: string | null
          created_at: string | null
          id: string
          notes: string | null
          paid_by: string | null
          payment_date: string | null
          payment_reference: string | null
          rejection_reason: string | null
          requested_by: string | null
          status: string
          updated_at: string | null
          vendor_id: string
        }
        Insert: {
          amount: number
          approved_by?: string | null
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          paid_by?: string | null
          payment_date?: string | null
          payment_reference?: string | null
          rejection_reason?: string | null
          requested_by?: string | null
          status?: string
          updated_at?: string | null
          vendor_id: string
        }
        Update: {
          amount?: number
          approved_by?: string | null
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          paid_by?: string | null
          payment_date?: string | null
          payment_reference?: string | null
          rejection_reason?: string | null
          requested_by?: string | null
          status?: string
          updated_at?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_withdrawals_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_earnings_summary"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "vendor_withdrawals_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          address: string | null
          auto_process_orders: boolean | null
          average_processing_time_hours: number | null
          bank_account_name: string | null
          bank_account_number: string | null
          bank_name: string | null
          banner_url: string | null
          business_name: string | null
          can_ship_nationwide: boolean | null
          city: string | null
          commission_rate: number | null
          created_at: string | null
          description: string | null
          email: string
          fulfilled_orders: number | null
          hub_id: string | null
          id: string
          is_active: boolean | null
          logo_url: string | null
          metadata: Json | null
          phone: string | null
          shipping_cost_responsibility: string | null
          state: string | null
          store_name: string
          store_slug: string | null
          tax_id: string | null
          total_orders: number | null
          updated_at: string | null
          user_id: string | null
          woocommerce_vendor_id: string
        }
        Insert: {
          address?: string | null
          auto_process_orders?: boolean | null
          average_processing_time_hours?: number | null
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          banner_url?: string | null
          business_name?: string | null
          can_ship_nationwide?: boolean | null
          city?: string | null
          commission_rate?: number | null
          created_at?: string | null
          description?: string | null
          email: string
          fulfilled_orders?: number | null
          hub_id?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          metadata?: Json | null
          phone?: string | null
          shipping_cost_responsibility?: string | null
          state?: string | null
          store_name: string
          store_slug?: string | null
          tax_id?: string | null
          total_orders?: number | null
          updated_at?: string | null
          user_id?: string | null
          woocommerce_vendor_id: string
        }
        Update: {
          address?: string | null
          auto_process_orders?: boolean | null
          average_processing_time_hours?: number | null
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          banner_url?: string | null
          business_name?: string | null
          can_ship_nationwide?: boolean | null
          city?: string | null
          commission_rate?: number | null
          created_at?: string | null
          description?: string | null
          email?: string
          fulfilled_orders?: number | null
          hub_id?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          metadata?: Json | null
          phone?: string | null
          shipping_cost_responsibility?: string | null
          state?: string | null
          store_name?: string
          store_slug?: string | null
          tax_id?: string | null
          total_orders?: number | null
          updated_at?: string | null
          user_id?: string | null
          woocommerce_vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendors_hub_id_fkey"
            columns: ["hub_id"]
            isOneToOne: false
            referencedRelation: "hub_performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendors_hub_id_fkey"
            columns: ["hub_id"]
            isOneToOne: false
            referencedRelation: "hubs"
            referencedColumns: ["id"]
          },
        ]
      }
      voucher_redemptions: {
        Row: {
          customer_email: string
          customer_name: string | null
          customer_paid: number
          discount_applied: number
          id: string
          julinemart_absorbed: number
          order_id: string | null
          order_metadata: Json | null
          original_price: number
          product_id: string | null
          redeemed_at: string | null
          sub_order_id: string | null
          vendor_id: string | null
          vendor_payout: number
          voucher_id: string
          woocommerce_order_id: string | null
        }
        Insert: {
          customer_email: string
          customer_name?: string | null
          customer_paid: number
          discount_applied: number
          id?: string
          julinemart_absorbed: number
          order_id?: string | null
          order_metadata?: Json | null
          original_price: number
          product_id?: string | null
          redeemed_at?: string | null
          sub_order_id?: string | null
          vendor_id?: string | null
          vendor_payout: number
          voucher_id: string
          woocommerce_order_id?: string | null
        }
        Update: {
          customer_email?: string
          customer_name?: string | null
          customer_paid?: number
          discount_applied?: number
          id?: string
          julinemart_absorbed?: number
          order_id?: string | null
          order_metadata?: Json | null
          original_price?: number
          product_id?: string | null
          redeemed_at?: string | null
          sub_order_id?: string | null
          vendor_id?: string | null
          vendor_payout?: number
          voucher_id?: string
          woocommerce_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "voucher_redemptions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_redemptions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_redemptions_sub_order_id_fkey"
            columns: ["sub_order_id"]
            isOneToOne: false
            referencedRelation: "sub_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_redemptions_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_earnings_summary"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "voucher_redemptions_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_redemptions_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "campaign_vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_errors: {
        Row: {
          created_at: string | null
          error_message: string | null
          error_stack: string | null
          id: string
          payload: Json | null
          woocommerce_order_id: string | null
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          error_stack?: string | null
          id?: string
          payload?: Json | null
          woocommerce_order_id?: string | null
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          error_stack?: string | null
          id?: string
          payload?: Json | null
          woocommerce_order_id?: string | null
        }
        Relationships: []
      }
      whatsapp_chats: {
        Row: {
          assigned_staff_id: string | null
          closed_at: string | null
          created_at: string | null
          customer_name: string | null
          customer_phone: string
          customer_profile_pic_url: string | null
          customer_service_window_expires_at: string | null
          id: string
          last_message_at: string | null
          last_message_preview: string | null
          linked_order_id: string | null
          metadata: Json | null
          status: Database["public"]["Enums"]["whatsapp_chat_status"] | null
          total_messages: number | null
          unread_count: number | null
          updated_at: string | null
        }
        Insert: {
          assigned_staff_id?: string | null
          closed_at?: string | null
          created_at?: string | null
          customer_name?: string | null
          customer_phone: string
          customer_profile_pic_url?: string | null
          customer_service_window_expires_at?: string | null
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          linked_order_id?: string | null
          metadata?: Json | null
          status?: Database["public"]["Enums"]["whatsapp_chat_status"] | null
          total_messages?: number | null
          unread_count?: number | null
          updated_at?: string | null
        }
        Update: {
          assigned_staff_id?: string | null
          closed_at?: string | null
          created_at?: string | null
          customer_name?: string | null
          customer_phone?: string
          customer_profile_pic_url?: string | null
          customer_service_window_expires_at?: string | null
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          linked_order_id?: string | null
          metadata?: Json | null
          status?: Database["public"]["Enums"]["whatsapp_chat_status"] | null
          total_messages?: number | null
          unread_count?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_chats_assigned_staff_id_fkey"
            columns: ["assigned_staff_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_chats_linked_order_id_fkey"
            columns: ["linked_order_id"]
            isOneToOne: false
            referencedRelation: "order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_chats_linked_order_id_fkey"
            columns: ["linked_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          chat_id: string
          content: string | null
          context_message_id: string | null
          created_at: string | null
          delivered_at: string | null
          direction: Database["public"]["Enums"]["whatsapp_message_direction"]
          error_code: string | null
          error_message: string | null
          id: string
          media_file_size: number | null
          media_mime_type: string | null
          media_sha256: string | null
          media_url: string | null
          message_type:
            | Database["public"]["Enums"]["whatsapp_message_type"]
            | null
          meta_message_id: string | null
          meta_wamid: string | null
          metadata: Json | null
          read_at: string | null
          sent_by_staff_id: string | null
          status: Database["public"]["Enums"]["whatsapp_message_status"] | null
        }
        Insert: {
          chat_id: string
          content?: string | null
          context_message_id?: string | null
          created_at?: string | null
          delivered_at?: string | null
          direction: Database["public"]["Enums"]["whatsapp_message_direction"]
          error_code?: string | null
          error_message?: string | null
          id?: string
          media_file_size?: number | null
          media_mime_type?: string | null
          media_sha256?: string | null
          media_url?: string | null
          message_type?:
            | Database["public"]["Enums"]["whatsapp_message_type"]
            | null
          meta_message_id?: string | null
          meta_wamid?: string | null
          metadata?: Json | null
          read_at?: string | null
          sent_by_staff_id?: string | null
          status?: Database["public"]["Enums"]["whatsapp_message_status"] | null
        }
        Update: {
          chat_id?: string
          content?: string | null
          context_message_id?: string | null
          created_at?: string | null
          delivered_at?: string | null
          direction?: Database["public"]["Enums"]["whatsapp_message_direction"]
          error_code?: string | null
          error_message?: string | null
          id?: string
          media_file_size?: number | null
          media_mime_type?: string | null
          media_sha256?: string | null
          media_url?: string | null
          message_type?:
            | Database["public"]["Enums"]["whatsapp_message_type"]
            | null
          meta_message_id?: string | null
          meta_wamid?: string | null
          metadata?: Json | null
          read_at?: string | null
          sent_by_staff_id?: string | null
          status?: Database["public"]["Enums"]["whatsapp_message_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_chat_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_sent_by_staff_id_fkey"
            columns: ["sent_by_staff_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_templates: {
        Row: {
          category: string
          created_at: string | null
          id: string
          is_active: boolean | null
          language: string | null
          last_used_at: string | null
          meta_template_id: string | null
          meta_template_status: string | null
          name: string
          template_content: string
          updated_at: string | null
          usage_count: number | null
        }
        Insert: {
          category: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          language?: string | null
          last_used_at?: string | null
          meta_template_id?: string | null
          meta_template_status?: string | null
          name: string
          template_content: string
          updated_at?: string | null
          usage_count?: number | null
        }
        Update: {
          category?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          language?: string | null
          last_used_at?: string | null
          meta_template_id?: string | null
          meta_template_status?: string | null
          name?: string
          template_content?: string
          updated_at?: string | null
          usage_count?: number | null
        }
        Relationships: []
      }
      whatsapp_webhook_events: {
        Row: {
          event_type: string
          id: string
          payload: Json
          processed: boolean | null
          processed_at: string | null
          processing_error: string | null
          received_at: string | null
        }
        Insert: {
          event_type: string
          id?: string
          payload: Json
          processed?: boolean | null
          processed_at?: string | null
          processing_error?: string | null
          received_at?: string | null
        }
        Update: {
          event_type?: string
          id?: string
          payload?: Json
          processed?: boolean | null
          processed_at?: string | null
          processing_error?: string | null
          received_at?: string | null
        }
        Relationships: []
      }
      zones: {
        Row: {
          cities: Json | null
          code: string
          created_at: string | null
          description: string | null
          estimated_delivery_days: number | null
          id: string
          is_active: boolean | null
          is_remote: boolean | null
          metadata: Json | null
          name: string
          states: string[]
          updated_at: string | null
          zone_type: string | null
        }
        Insert: {
          cities?: Json | null
          code: string
          created_at?: string | null
          description?: string | null
          estimated_delivery_days?: number | null
          id?: string
          is_active?: boolean | null
          is_remote?: boolean | null
          metadata?: Json | null
          name: string
          states: string[]
          updated_at?: string | null
          zone_type?: string | null
        }
        Update: {
          cities?: Json | null
          code?: string
          created_at?: string | null
          description?: string | null
          estimated_delivery_days?: number | null
          id?: string
          is_active?: boolean | null
          is_remote?: boolean | null
          metadata?: Json | null
          name?: string
          states?: string[]
          updated_at?: string | null
          zone_type?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      annual_tax_summary_view: {
        Row: {
          commission_revenue: number | null
          expense_transaction_count: number | null
          fee_revenue: number | null
          fiscal_year: number | null
          gross_profit: number | null
          net_vat_liability: number | null
          non_deductible_expenses: number | null
          revenue_transaction_count: number | null
          shipping_revenue: number | null
          tax_deductible_expenses: number | null
          taxable_income: number | null
          total_expenses: number | null
          total_revenue: number | null
          vat_collected: number | null
          vat_paid: number | null
          year: string | null
        }
        Relationships: []
      }
      cash_flow_view: {
        Row: {
          cash_inflow: number | null
          cash_outflow: number | null
          cumulative_cash_flow: number | null
          month: string | null
          net_cash_flow: number | null
          period: string | null
        }
        Relationships: []
      }
      courier_performance: {
        Row: {
          avg_delivery_days: number | null
          failed_deliveries: number | null
          id: string | null
          name: string | null
          success_rate_percent: number | null
          successful_deliveries: number | null
          total_deliveries: number | null
          total_revenue: number | null
          type: Database["public"]["Enums"]["courier_type"] | null
        }
        Relationships: []
      }
      courier_settlement_summary: {
        Row: {
          courier_id: string | null
          courier_name: string | null
          created_at: string | null
          id: string | null
          paid_by_name: string | null
          payment_date: string | null
          payment_reference: string | null
          settlement_period_end: string | null
          settlement_period_start: string | null
          status: string | null
          total_amount_due: number | null
          total_amount_paid: number | null
          total_shipments: number | null
        }
        Relationships: [
          {
            foreignKeyName: "courier_settlements_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "courier_performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_settlements_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_settlements_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "pending_courier_payments"
            referencedColumns: ["courier_id"]
          },
        ]
      }
      expense_by_category_view: {
        Row: {
          avg_amount: number | null
          category: string | null
          deductible_amount: number | null
          deductible_count: number | null
          max_amount: number | null
          min_amount: number | null
          month: string | null
          source: string | null
          subcategory: string | null
          total_amount: number | null
          transaction_count: number | null
        }
        Relationships: []
      }
      finance_expenses_view: {
        Row: {
          amount: number | null
          category: string | null
          created_at: string | null
          currency: string | null
          description: string | null
          fiscal_month: number | null
          fiscal_year: number | null
          id: string | null
          paid_at: string | null
          paid_to: string | null
          payment_method: string | null
          period_month: string | null
          period_quarter: string | null
          source: string | null
          source_reference: string | null
          subcategory: string | null
          tax_deductible: boolean | null
          vat_amount: number | null
        }
        Insert: {
          amount?: number | null
          category?: string | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          fiscal_month?: number | null
          fiscal_year?: number | null
          id?: string | null
          paid_at?: string | null
          paid_to?: string | null
          payment_method?: string | null
          period_month?: never
          period_quarter?: never
          source?: string | null
          source_reference?: string | null
          subcategory?: string | null
          tax_deductible?: boolean | null
          vat_amount?: number | null
        }
        Update: {
          amount?: number | null
          category?: string | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          fiscal_month?: number | null
          fiscal_year?: number | null
          id?: string | null
          paid_at?: string | null
          paid_to?: string | null
          payment_method?: string | null
          period_month?: never
          period_quarter?: never
          source?: string | null
          source_reference?: string | null
          subcategory?: string | null
          tax_deductible?: boolean | null
          vat_amount?: number | null
        }
        Relationships: []
      }
      finance_revenue_view: {
        Row: {
          amount: number | null
          commission_amount: number | null
          created_at: string | null
          currency: string | null
          description: string | null
          fiscal_month: number | null
          fiscal_year: number | null
          id: string | null
          order_id: string | null
          other_revenue: number | null
          period_month: string | null
          period_quarter: string | null
          platform_fee: number | null
          received_at: string | null
          shipping_margin: number | null
          source: string | null
          vat_amount: number | null
          vat_applicable: boolean | null
          vat_rate: number | null
        }
        Insert: {
          amount?: number | null
          commission_amount?: number | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          fiscal_month?: number | null
          fiscal_year?: number | null
          id?: string | null
          order_id?: string | null
          other_revenue?: number | null
          period_month?: never
          period_quarter?: never
          platform_fee?: number | null
          received_at?: string | null
          shipping_margin?: number | null
          source?: string | null
          vat_amount?: number | null
          vat_applicable?: boolean | null
          vat_rate?: number | null
        }
        Update: {
          amount?: number | null
          commission_amount?: number | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          fiscal_month?: number | null
          fiscal_year?: number | null
          id?: string | null
          order_id?: string | null
          other_revenue?: number | null
          period_month?: never
          period_quarter?: never
          platform_fee?: number | null
          received_at?: string | null
          shipping_margin?: number | null
          source?: string | null
          vat_amount?: number | null
          vat_applicable?: boolean | null
          vat_rate?: number | null
        }
        Relationships: []
      }
      hub_performance: {
        Row: {
          avg_delivery_days: number | null
          city: string | null
          delivered_orders: number | null
          failed_orders: number | null
          id: string | null
          name: string | null
          state: string | null
          total_orders: number | null
          total_shipping_cost: number | null
        }
        Relationships: []
      }
      monthly_pnl_view: {
        Row: {
          commission_revenue: number | null
          expenses: number | null
          fee_revenue: number | null
          gross_profit: number | null
          month: string | null
          net_vat_liability: number | null
          period: string | null
          profit_margin_pct: number | null
          revenue: number | null
          shipping_revenue: number | null
          tax_deductible_expenses: number | null
          vat_collected: number | null
          vat_paid: number | null
        }
        Relationships: []
      }
      order_summary: {
        Row: {
          created_at: string | null
          customer_email: string | null
          customer_name: string | null
          delivery_city: string | null
          delivery_state: string | null
          hub_count: number | null
          id: string | null
          overall_status: Database["public"]["Enums"]["order_status"] | null
          payment_status: Database["public"]["Enums"]["payment_status"] | null
          shipping_fee_paid: number | null
          sub_order_count: number | null
          sub_order_statuses:
            | Database["public"]["Enums"]["delivery_status"][]
            | null
          total_amount: number | null
          total_real_shipping_cost: number | null
          woocommerce_order_id: string | null
        }
        Relationships: []
      }
      pending_courier_payments: {
        Row: {
          courier_code: string | null
          courier_id: string | null
          courier_name: string | null
          last_shipment_date: string | null
          pending_shipments: number | null
          total_amount_due: number | null
        }
        Relationships: []
      }
      quarterly_pnl_view: {
        Row: {
          expenses: number | null
          gross_profit: number | null
          period: string | null
          profit_margin_pct: number | null
          quarter: string | null
          revenue: number | null
        }
        Relationships: []
      }
      revenue_by_source_view: {
        Row: {
          avg_revenue_per_transaction: number | null
          month: string | null
          source: string | null
          total_commission: number | null
          total_revenue: number | null
          total_shipping_margin: number | null
          total_vat: number | null
          transaction_count: number | null
        }
        Relationships: []
      }
      vat_summary_view: {
        Row: {
          first_transaction: string | null
          last_transaction: string | null
          net_vat_liability: number | null
          period_end: string | null
          period_month: string | null
          period_start: string | null
          total_collected: number | null
          total_payable: number | null
          transaction_count: number | null
        }
        Relationships: []
      }
      vendor_earnings_summary: {
        Row: {
          available_balance: number | null
          commission_rate: number | null
          gross_sales: number | null
          net_earnings: number | null
          platform_commission: number | null
          store_name: string | null
          total_orders: number | null
          total_withdrawn: number | null
          vendor_id: string | null
        }
        Relationships: []
      }
      vendor_monthly_earnings: {
        Row: {
          gross_sales: number | null
          month: string | null
          net_earnings: number | null
          orders: number | null
          platform_commission: number | null
          vendor_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_earnings_summary"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "order_items_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_chat_summary: {
        Row: {
          assigned_staff_id: string | null
          assigned_staff_name: string | null
          closed_at: string | null
          created_at: string | null
          customer_name: string | null
          customer_phone: string | null
          customer_profile_pic_url: string | null
          customer_service_window_expires_at: string | null
          id: string | null
          last_message_at: string | null
          last_message_preview: string | null
          linked_order_id: string | null
          order_status: Database["public"]["Enums"]["order_status"] | null
          status: Database["public"]["Enums"]["whatsapp_chat_status"] | null
          total_messages: number | null
          unread_count: number | null
          updated_at: string | null
          within_service_window: boolean | null
          woocommerce_order_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_chats_assigned_staff_id_fkey"
            columns: ["assigned_staff_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_chats_linked_order_id_fkey"
            columns: ["linked_order_id"]
            isOneToOne: false
            referencedRelation: "order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_chats_linked_order_id_fkey"
            columns: ["linked_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      auto_assign_courier: { Args: { p_sub_order_id: string }; Returns: string }
      backfill_historical_revenue: {
        Args: never
        Returns: {
          errors: string[]
          orders_processed: number
          revenue_entries_created: number
          total_revenue: number
        }[]
      }
      calculate_order_revenue: {
        Args: { p_order_id: string }
        Returns: {
          commission_amount: number
          shipping_margin: number
          total_revenue: number
          vat_amount: number
        }[]
      }
      calculate_shipping_cost: {
        Args: {
          p_courier_id: string
          p_hub_id: string
          p_order_value: number
          p_total_weight: number
          p_zone_id: string
        }
        Returns: number
      }
      check_revenue_sync_health: {
        Args: never
        Returns: {
          metric: string
          notes: string
          status: string
          value: number
        }[]
      }
      create_courier_settlement: {
        Args: { p_courier_id: string; p_end_date: string; p_start_date: string }
        Returns: string
      }
      create_tracking_event: {
        Args: {
          p_actor_name?: string
          p_description: string
          p_location_name?: string
          p_status: Database["public"]["Enums"]["delivery_status"]
          p_sub_order_id: string
        }
        Returns: string
      }
      get_user_role: { Args: never; Returns: string }
      get_zone_by_state: { Args: { p_state: string }; Returns: string }
      log_finance_access: {
        Args: { p_action: string; p_metadata?: Json; p_table: string }
        Returns: undefined
      }
      update_influencer_stats: {
        Args: { p_influencer_id: string }
        Returns: undefined
      }
      user_has_role: {
        Args: { required_role: string; uid: string }
        Returns: boolean
      }
    }
    Enums: {
      courier_type:
        | "fez"
        | "gigl"
        | "kwik"
        | "gokada"
        | "dhl"
        | "other"
        | "manual"
      delivery_status:
        | "pending"
        | "assigned"
        | "picked_up"
        | "in_transit"
        | "out_for_delivery"
        | "delivered"
        | "failed"
        | "returned"
      order_status:
        | "pending"
        | "processing"
        | "partially_shipped"
        | "shipped"
        | "delivered"
        | "cancelled"
        | "refunded"
      payment_status: "pending" | "paid" | "failed" | "refunded"
      product_status: "draft" | "published" | "archived" | "trash"
      product_type: "simple" | "variable"
      stock_status_type: "instock" | "outofstock" | "onbackorder"
      whatsapp_chat_status: "open" | "assigned" | "closed"
      whatsapp_message_direction: "inbound" | "outbound"
      whatsapp_message_status: "sent" | "delivered" | "read" | "failed"
      whatsapp_message_type:
        | "text"
        | "image"
        | "audio"
        | "video"
        | "document"
        | "location"
        | "contacts"
        | "sticker"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      courier_type: ["fez", "gigl", "kwik", "gokada", "dhl", "other", "manual"],
      delivery_status: [
        "pending",
        "assigned",
        "picked_up",
        "in_transit",
        "out_for_delivery",
        "delivered",
        "failed",
        "returned",
      ],
      order_status: [
        "pending",
        "processing",
        "partially_shipped",
        "shipped",
        "delivered",
        "cancelled",
        "refunded",
      ],
      payment_status: ["pending", "paid", "failed", "refunded"],
      product_status: ["draft", "published", "archived", "trash"],
      product_type: ["simple", "variable"],
      stock_status_type: ["instock", "outofstock", "onbackorder"],
      whatsapp_chat_status: ["open", "assigned", "closed"],
      whatsapp_message_direction: ["inbound", "outbound"],
      whatsapp_message_status: ["sent", "delivered", "read", "failed"],
      whatsapp_message_type: [
        "text",
        "image",
        "audio",
        "video",
        "document",
        "location",
        "contacts",
        "sticker",
      ],
    },
  },
} as const
