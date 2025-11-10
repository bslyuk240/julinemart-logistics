export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          operationName?: string
          query?: string
          variables?: Json
          extensions?: Json
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
  public: {
    Tables: {
      couriers: {
        Row: {
          api_key_encrypted: string | null
          api_url: string | null
          api_username: string | null
          average_delivery_time_days: number | null
          base_rate: number | null
          code: string
          created_at: string | null
          excluded_zones: string[] | null
          id: string
          is_active: boolean | null
          metadata: Json | null
          name: string
          rate_per_kg: number | null
          service_zones: string[] | null
          success_rate: number | null
          supports_cod: boolean | null
          supports_tracking: boolean | null
          type: Database["public"]["Enums"]["courier_type"]
          updated_at: string | null
          webhook_url: string | null
        }
        Insert: {
          api_key_encrypted?: string | null
          api_url?: string | null
          api_username?: string | null
          average_delivery_time_days?: number | null
          base_rate?: number | null
          code: string
          created_at?: string | null
          excluded_zones?: string[] | null
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          name: string
          rate_per_kg?: number | null
          service_zones?: string[] | null
          success_rate?: number | null
          supports_cod?: boolean | null
          supports_tracking?: boolean | null
          type: Database["public"]["Enums"]["courier_type"]
          updated_at?: string | null
          webhook_url?: string | null
        }
        Update: {
          api_key_encrypted?: string | null
          api_url?: string | null
          api_username?: string | null
          average_delivery_time_days?: number | null
          base_rate?: number | null
          code?: string
          created_at?: string | null
          excluded_zones?: string[] | null
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          name?: string
          rate_per_kg?: number | null
          service_zones?: string[] | null
          success_rate?: number | null
          supports_cod?: boolean | null
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
      hub_couriers: {
        Row: {
          courier_id: string | null
          created_at: string | null
          custom_base_rate: number | null
          hub_id: string | null
          id: string
          is_primary: boolean | null
          priority: number | null
        }
        Insert: {
          courier_id?: string | null
          created_at?: string | null
          custom_base_rate?: number | null
          hub_id?: string | null
          id?: string
          is_primary?: boolean | null
          priority?: number | null
        }
        Update: {
          courier_id?: string | null
          created_at?: string | null
          custom_base_rate?: number | null
          hub_id?: string | null
          id?: string
          is_primary?: boolean | null
          priority?: number | null
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
        ]
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
          id: string
          metadata: Json | null
          order_notes: string | null
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
          woocommerce_order_id: string
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
          id?: string
          metadata?: Json | null
          order_notes?: string | null
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
          woocommerce_order_id: string
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
          id?: string
          metadata?: Json | null
          order_notes?: string | null
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
          woocommerce_order_id?: string
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
            foreignKeyName: "rate_history_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
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
          courier_id: string | null
          courier_notes: string | null
          courier_waybill: string | null
          created_at: string | null
          delivered_at: string | null
          delivery_proof_url: string | null
          failed_at: string | null
          hub_id: string | null
          hub_notes: string | null
          id: string
          in_transit_at: string | null
          items: Json
          main_order_id: string | null
          metadata: Json | null
          out_for_delivery_at: string | null
          picked_up_at: string | null
          pickup_scheduled_at: string | null
          real_shipping_cost: number | null
          rider_name: string | null
          rider_phone: string | null
          status: Database["public"]["Enums"]["delivery_status"] | null
          subtotal: number
          tracking_number: string | null
          updated_at: string | null
          vendor_id: string | null
        }
        Insert: {
          allocated_shipping_fee?: number | null
          courier_id?: string | null
          courier_notes?: string | null
          courier_waybill?: string | null
          created_at?: string | null
          delivered_at?: string | null
          delivery_proof_url?: string | null
          failed_at?: string | null
          hub_id?: string | null
          hub_notes?: string | null
          id?: string
          in_transit_at?: string | null
          items: Json
          main_order_id?: string | null
          metadata?: Json | null
          out_for_delivery_at?: string | null
          picked_up_at?: string | null
          pickup_scheduled_at?: string | null
          real_shipping_cost?: number | null
          rider_name?: string | null
          rider_phone?: string | null
          status?: Database["public"]["Enums"]["delivery_status"] | null
          subtotal: number
          tracking_number?: string | null
          updated_at?: string | null
          vendor_id?: string | null
        }
        Update: {
          allocated_shipping_fee?: number | null
          courier_id?: string | null
          courier_notes?: string | null
          courier_waybill?: string | null
          created_at?: string | null
          delivered_at?: string | null
          delivery_proof_url?: string | null
          failed_at?: string | null
          hub_id?: string | null
          hub_notes?: string | null
          id?: string
          in_transit_at?: string | null
          items?: Json
          main_order_id?: string | null
          metadata?: Json | null
          out_for_delivery_at?: string | null
          picked_up_at?: string | null
          pickup_scheduled_at?: string | null
          real_shipping_cost?: number | null
          rider_name?: string | null
          rider_phone?: string | null
          status?: Database["public"]["Enums"]["delivery_status"] | null
          subtotal?: number
          tracking_number?: string | null
          updated_at?: string | null
          vendor_id?: string | null
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
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
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
      vendors: {
        Row: {
          address: string | null
          auto_process_orders: boolean | null
          average_processing_time_hours: number | null
          business_name: string | null
          can_ship_nationwide: boolean | null
          city: string | null
          commission_rate: number | null
          created_at: string | null
          email: string
          fulfilled_orders: number | null
          hub_id: string | null
          id: string
          is_active: boolean | null
          metadata: Json | null
          phone: string | null
          shipping_cost_responsibility: string | null
          state: string | null
          store_name: string
          store_slug: string | null
          tax_id: string | null
          total_orders: number | null
          updated_at: string | null
          woocommerce_vendor_id: string
        }
        Insert: {
          address?: string | null
          auto_process_orders?: boolean | null
          average_processing_time_hours?: number | null
          business_name?: string | null
          can_ship_nationwide?: boolean | null
          city?: string | null
          commission_rate?: number | null
          created_at?: string | null
          email: string
          fulfilled_orders?: number | null
          hub_id?: string | null
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          phone?: string | null
          shipping_cost_responsibility?: string | null
          state?: string | null
          store_name: string
          store_slug?: string | null
          tax_id?: string | null
          total_orders?: number | null
          updated_at?: string | null
          woocommerce_vendor_id: string
        }
        Update: {
          address?: string | null
          auto_process_orders?: boolean | null
          average_processing_time_hours?: number | null
          business_name?: string | null
          can_ship_nationwide?: boolean | null
          city?: string | null
          commission_rate?: number | null
          created_at?: string | null
          email?: string
          fulfilled_orders?: number | null
          hub_id?: string | null
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          phone?: string | null
          shipping_cost_responsibility?: string | null
          state?: string | null
          store_name?: string
          store_slug?: string | null
          tax_id?: string | null
          total_orders?: number | null
          updated_at?: string | null
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
      zones: {
        Row: {
          cities: Json | null
          code: string
          created_at: string | null
          description: string | null
          estimated_delivery_days: number | null
          id: string
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
    }
    Functions: {
      auto_assign_courier: {
        Args: {
          p_sub_order_id: string
        }
        Returns: string
      }
      calculate_shipping_cost: {
        Args: {
          p_zone_id: string
          p_hub_id: string
          p_courier_id: string
          p_total_weight: number
          p_order_value: number
        }
        Returns: number
      }
      create_tracking_event: {
        Args: {
          p_sub_order_id: string
          p_status: Database["public"]["Enums"]["delivery_status"]
          p_description: string
          p_location_name?: string
          p_actor_name?: string
        }
        Returns: string
      }
      get_zone_by_state: {
        Args: {
          p_state: string
        }
        Returns: string
      }
    }
    Enums: {
      courier_type: "fez" | "gigl" | "kwik" | "gokada" | "dhl" | "other"
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
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          updated_at: string | null
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          updated_at?: string | null
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          bucket_id: string | null
          created_at: string | null
          id: string
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        Insert: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_insert_object: {
        Args: {
          bucketid: string
          name: string
          owner: string
          metadata: Json
        }
        Returns: undefined
      }
      extension: {
        Args: {
          name: string
        }
        Returns: string
      }
      filename: {
        Args: {
          name: string
        }
        Returns: string
      }
      foldername: {
        Args: {
          name: string
        }
        Returns: string[]
      }
      get_size_by_bucket: {
        Args: Record<PropertyKey, never>
        Returns: {
          size: number
          bucket_id: string
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          prefix_param: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
        }
        Returns: {
          key: string
          id: string
          created_at: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          bucket_id: string
          prefix_param: string
          delimiter_param: string
          max_keys?: number
          start_after?: string
          next_token?: string
        }
        Returns: {
          name: string
          id: string
          metadata: Json
          updated_at: string
        }[]
      }
      operation: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      search: {
        Args: {
          prefix: string
          bucketname: string
          limits?: number
          levels?: number
          offsets?: number
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          name: string
          id: string
          updated_at: string
          created_at: string
          last_accessed_at: string
          metadata: Json
        }[]
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

type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof PublicSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof PublicSchema["CompositeTypes"]
    ? PublicSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

