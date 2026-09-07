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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      breed_photos: {
        Row: {
          breed: string
          created_at: string | null
          id: string
          photo_url: string
        }
        Insert: {
          breed: string
          created_at?: string | null
          id?: string
          photo_url: string
        }
        Update: {
          breed?: string
          created_at?: string | null
          id?: string
          photo_url?: string
        }
        Relationships: []
      }
      inventory: {
        Row: {
          id: string
          product_id: string
          quantity: number
          updated_at: string | null
        }
        Insert: {
          id?: string
          product_id: string
          quantity?: number
          updated_at?: string | null
        }
        Update: {
          id?: string
          product_id?: string
          quantity?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          address: string | null
          city: string | null
          created_at: string | null
          geom: unknown
          id: string
          is_default: boolean | null
          latitude: number | null
          longitude: number | null
          name: string
          postal_code: string | null
          state: string | null
          user_id: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string | null
          geom?: unknown
          id?: string
          is_default?: boolean | null
          latitude?: number | null
          longitude?: number | null
          name: string
          postal_code?: string | null
          state?: string | null
          user_id: string
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string | null
          geom?: unknown
          id?: string
          is_default?: boolean | null
          latitude?: number | null
          longitude?: number | null
          name?: string
          postal_code?: string | null
          state?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string | null
          data: Json | null
          id: string
          is_read: boolean
          message: string
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          data?: Json | null
          id?: string
          is_read?: boolean
          message: string
          title: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          data?: Json | null
          id?: string
          is_read?: boolean
          message?: string
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pet_documents: {
        Row: {
          document_type: string
          file_name: string
          file_path: string
          file_size: number
          id: string
          mime_type: string
          notes: string | null
          pet_id: string
          uploaded_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          document_type: string
          file_name: string
          file_path: string
          file_size: number
          id?: string
          mime_type: string
          notes?: string | null
          pet_id: string
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          document_type?: string
          file_name?: string
          file_path?: string
          file_size?: number
          id?: string
          mime_type?: string
          notes?: string | null
          pet_id?: string
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pet_documents_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      pet_models_3d: {
        Row: {
          breed: string
          created_at: string | null
          glb_url: string
          id: string
          pet_id: string | null
        }
        Insert: {
          breed: string
          created_at?: string | null
          glb_url: string
          id?: string
          pet_id?: string | null
        }
        Update: {
          breed?: string
          created_at?: string | null
          glb_url?: string
          id?: string
          pet_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pet_models_3d_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      pets: {
        Row: {
          age: number | null
          avatar_url: string | null
          behavioral_notes: string | null
          breed: string
          created_at: string | null
          e2e_run_id: string | null
          e2e_test: boolean | null
          emergency_contact: string | null
          gender: string | null
          id: string
          is_active: boolean | null
          medical_info: string | null
          name: string
          owner_id: string
          updated_at: string | null
          weight: number | null
        }
        Insert: {
          age?: number | null
          avatar_url?: string | null
          behavioral_notes?: string | null
          breed: string
          created_at?: string | null
          e2e_run_id?: string | null
          e2e_test?: boolean | null
          emergency_contact?: string | null
          gender?: string | null
          id?: string
          is_active?: boolean | null
          medical_info?: string | null
          name: string
          owner_id: string
          updated_at?: string | null
          weight?: number | null
        }
        Update: {
          age?: number | null
          avatar_url?: string | null
          behavioral_notes?: string | null
          breed?: string
          created_at?: string | null
          e2e_run_id?: string | null
          e2e_test?: boolean | null
          emergency_contact?: string | null
          gender?: string | null
          id?: string
          is_active?: boolean | null
          medical_info?: string | null
          name?: string
          owner_id?: string
          updated_at?: string | null
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pets_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      petwalker_applications: {
        Row: {
          birth_date: string
          city: string
          created_at: string | null
          document_status: string | null
          emergency_contact_name: string
          emergency_contact_phone: string
          experience_description: string
          id: string
          legal_name: string
          phone: string
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
          submitted_at: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          birth_date: string
          city: string
          created_at?: string | null
          document_status?: string | null
          emergency_contact_name: string
          emergency_contact_phone: string
          experience_description: string
          id?: string
          legal_name: string
          phone: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          submitted_at?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          birth_date?: string
          city?: string
          created_at?: string | null
          document_status?: string | null
          emergency_contact_name?: string
          emergency_contact_phone?: string
          experience_description?: string
          id?: string
          legal_name?: string
          phone?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          submitted_at?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      petwalker_earnings: {
        Row: {
          available_at: string | null
          created_at: string | null
          gross_amount: number
          id: string
          net_amount: number
          paid_at: string | null
          petwalker_id: string
          platform_fee: number
          status: string | null
          walk_session_id: string | null
        }
        Insert: {
          available_at?: string | null
          created_at?: string | null
          gross_amount?: number
          id?: string
          net_amount?: number
          paid_at?: string | null
          petwalker_id: string
          platform_fee?: number
          status?: string | null
          walk_session_id?: string | null
        }
        Update: {
          available_at?: string | null
          created_at?: string | null
          gross_amount?: number
          id?: string
          net_amount?: number
          paid_at?: string | null
          petwalker_id?: string
          platform_fee?: number
          status?: string | null
          walk_session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "petwalker_earnings_petwalker_id_fkey"
            columns: ["petwalker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petwalker_earnings_walk_session_id_fkey"
            columns: ["walk_session_id"]
            isOneToOne: false
            referencedRelation: "walk_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      petwalker_profiles: {
        Row: {
          approval_status:
            | Database["public"]["Enums"]["application_status"]
            | null
          availability_status: string | null
          cancellation_rate: number | null
          completed_walks: number | null
          created_at: string | null
          current_walk_id: string | null
          e2e_test: boolean | null
          experience_years: number | null
          is_accepting_requests: boolean | null
          last_known_location: unknown
          last_location_at: string | null
          last_location_captured_at: number | null
          last_online_at: string | null
          price_30_minutes: number | null
          profile_completed: boolean | null
          public_bio: string | null
          rating_average: number | null
          service_radius_km: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          approval_status?:
            | Database["public"]["Enums"]["application_status"]
            | null
          availability_status?: string | null
          cancellation_rate?: number | null
          completed_walks?: number | null
          created_at?: string | null
          current_walk_id?: string | null
          e2e_test?: boolean | null
          experience_years?: number | null
          is_accepting_requests?: boolean | null
          last_known_location?: unknown
          last_location_at?: string | null
          last_location_captured_at?: number | null
          last_online_at?: string | null
          price_30_minutes?: number | null
          profile_completed?: boolean | null
          public_bio?: string | null
          rating_average?: number | null
          service_radius_km?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          approval_status?:
            | Database["public"]["Enums"]["application_status"]
            | null
          availability_status?: string | null
          cancellation_rate?: number | null
          completed_walks?: number | null
          created_at?: string | null
          current_walk_id?: string | null
          e2e_test?: boolean | null
          experience_years?: number | null
          is_accepting_requests?: boolean | null
          last_known_location?: unknown
          last_location_at?: string | null
          last_location_captured_at?: number | null
          last_online_at?: string | null
          price_30_minutes?: number | null
          profile_completed?: boolean | null
          public_bio?: string | null
          rating_average?: number | null
          service_radius_km?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      post_comments: {
        Row: {
          content: string
          created_at: string | null
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      post_likes: {
        Row: {
          created_at: string | null
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          content: string
          created_at: string | null
          id: string
          image_url: string | null
          likes_count: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          image_url?: string | null
          likes_count?: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          image_url?: string | null
          likes_count?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "posts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      product_images: {
        Row: {
          created_at: string | null
          display_order: number | null
          id: string
          image_url: string
          product_id: string
        }
        Insert: {
          created_at?: string | null
          display_order?: number | null
          id?: string
          image_url: string
          product_id: string
        }
        Update: {
          created_at?: string | null
          display_order?: number | null
          id?: string
          image_url?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category: string | null
          created_at: string | null
          description: string | null
          dimensions: string | null
          id: string
          is_active: boolean | null
          name: string
          origin_city: string | null
          petshop_id: string
          price: number
          updated_at: string | null
          weight: number | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          dimensions?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          origin_city?: string | null
          petshop_id: string
          price?: number
          updated_at?: string | null
          weight?: number | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          dimensions?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          origin_city?: string | null
          petshop_id?: string
          price?: number
          updated_at?: string | null
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_petshop_id_fkey"
            columns: ["petshop_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          age: number | null
          avatar_url: string | null
          bio: string | null
          birthday: string | null
          created_at: string | null
          e2e_test: boolean | null
          email: string | null
          full_name: string | null
          id: string
          onboarding_completed: boolean | null
          phone: string | null
          role: string | null
          signup_intent:
            | Database["public"]["Enums"]["signup_intent_type"]
            | null
          updated_at: string | null
        }
        Insert: {
          age?: number | null
          avatar_url?: string | null
          bio?: string | null
          birthday?: string | null
          created_at?: string | null
          e2e_test?: boolean | null
          email?: string | null
          full_name?: string | null
          id: string
          onboarding_completed?: boolean | null
          phone?: string | null
          role?: string | null
          signup_intent?:
            | Database["public"]["Enums"]["signup_intent_type"]
            | null
          updated_at?: string | null
        }
        Update: {
          age?: number | null
          avatar_url?: string | null
          bio?: string | null
          birthday?: string | null
          created_at?: string | null
          e2e_test?: boolean | null
          email?: string | null
          full_name?: string | null
          id?: string
          onboarding_completed?: boolean | null
          phone?: string | null
          role?: string | null
          signup_intent?:
            | Database["public"]["Enums"]["signup_intent_type"]
            | null
          updated_at?: string | null
        }
        Relationships: []
      }
      spatial_ref_sys: {
        Row: {
          auth_name: string | null
          auth_srid: number | null
          proj4text: string | null
          srid: number
          srtext: string | null
        }
        Insert: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid: number
          srtext?: string | null
        }
        Update: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid?: number
          srtext?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      walk_matching_settings: {
        Row: {
          active: boolean | null
          expansion_interval_minutes: number | null
          id: number
          initial_radius_meters: number | null
          initial_search_radius_km: number | null
          max_radius_meters: number | null
          max_search_duration_minutes: number | null
          max_search_radius_km: number | null
          radius_expansion_step_km: number | null
          radius_expansion_step_meters: number | null
          session_expiry_minutes: number | null
        }
        Insert: {
          active?: boolean | null
          expansion_interval_minutes?: number | null
          id?: number
          initial_radius_meters?: number | null
          initial_search_radius_km?: number | null
          max_radius_meters?: number | null
          max_search_duration_minutes?: number | null
          max_search_radius_km?: number | null
          radius_expansion_step_km?: number | null
          radius_expansion_step_meters?: number | null
          session_expiry_minutes?: number | null
        }
        Update: {
          active?: boolean | null
          expansion_interval_minutes?: number | null
          id?: number
          initial_radius_meters?: number | null
          initial_search_radius_km?: number | null
          max_radius_meters?: number | null
          max_search_duration_minutes?: number | null
          max_search_radius_km?: number | null
          radius_expansion_step_km?: number | null
          radius_expansion_step_meters?: number | null
          session_expiry_minutes?: number | null
        }
        Relationships: []
      }
      walk_offers: {
        Row: {
          created_at: string | null
          id: string
          offer_status: Database["public"]["Enums"]["walk_offer_status"] | null
          session_id: string
          updated_at: string
          walker_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          offer_status?: Database["public"]["Enums"]["walk_offer_status"] | null
          session_id: string
          updated_at?: string
          walker_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          offer_status?: Database["public"]["Enums"]["walk_offer_status"] | null
          session_id?: string
          updated_at?: string
          walker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "walk_offers_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "walk_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "walk_offers_walker_id_fkey"
            columns: ["walker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      walk_pickup_codes: {
        Row: {
          attempts: number
          created_at: string
          e2e_run_id: string | null
          expires_at: string
          pin_code: string
          session_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          e2e_run_id?: string | null
          expires_at: string
          pin_code: string
          session_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          e2e_run_id?: string | null
          expires_at?: string
          pin_code?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "walk_pickup_codes_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "walk_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      walk_pricing_settings: {
        Row: {
          created_at: string | null
          duration_step_minutes: number
          id: string
          is_active: boolean | null
          minimum_duration_minutes: number
          now_surcharge_cents: number | null
          price_per_minute_cents: number
          scheduled_surcharge_cents: number | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          created_at?: string | null
          duration_step_minutes: number
          id?: string
          is_active?: boolean | null
          minimum_duration_minutes: number
          now_surcharge_cents?: number | null
          price_per_minute_cents: number
          scheduled_surcharge_cents?: number | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          created_at?: string | null
          duration_step_minutes?: number
          id?: string
          is_active?: boolean | null
          minimum_duration_minutes?: number
          now_surcharge_cents?: number | null
          price_per_minute_cents?: number
          scheduled_surcharge_cents?: number | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: []
      }
      walk_sessions: {
        Row: {
          actual_duration_minutes: number | null
          arrived_at: string | null
          created_at: string
          current_radius_meters: number | null
          current_status: Database["public"]["Enums"]["walk_status"]
          customer_id: string
          distance_km: number | null
          e2e_run_id: string | null
          e2e_test: boolean | null
          end_time: string | null
          feedback: string | null
          heading_started_at: string | null
          home_location: Json | null
          id: string
          last_expansion_at: string | null
          last_tracking_at: string | null
          local_stops: Json | null
          matching_expires_at: string | null
          meeting_point_address: string | null
          meeting_point_geom: unknown
          meeting_point_location: unknown
          pet_id: string
          pet_ids: string[] | null
          petwalker_notified_at: string | null
          pickup_confirmed_at: string | null
          planned_duration_minutes: number
          price_per_minute_cents: number | null
          pricing_surcharge_cents: number | null
          pricing_version: number | null
          rating: number | null
          request_mode: Database["public"]["Enums"]["walk_request_mode"] | null
          route_coordinates: Json | null
          scheduled_for: string | null
          search_radius_km: number | null
          search_started_at: string | null
          start_time: string
          status: string
          total_price_cents: number | null
          updated_at: string
          walk_type: string
          walker_id: string | null
          walker_name: string | null
        }
        Insert: {
          actual_duration_minutes?: number | null
          arrived_at?: string | null
          created_at?: string
          current_radius_meters?: number | null
          current_status?: Database["public"]["Enums"]["walk_status"]
          customer_id: string
          distance_km?: number | null
          e2e_run_id?: string | null
          e2e_test?: boolean | null
          end_time?: string | null
          feedback?: string | null
          heading_started_at?: string | null
          home_location?: Json | null
          id?: string
          last_expansion_at?: string | null
          last_tracking_at?: string | null
          local_stops?: Json | null
          matching_expires_at?: string | null
          meeting_point_address?: string | null
          meeting_point_geom?: unknown
          meeting_point_location?: unknown
          pet_id: string
          pet_ids?: string[] | null
          petwalker_notified_at?: string | null
          pickup_confirmed_at?: string | null
          planned_duration_minutes?: number
          price_per_minute_cents?: number | null
          pricing_surcharge_cents?: number | null
          pricing_version?: number | null
          rating?: number | null
          request_mode?: Database["public"]["Enums"]["walk_request_mode"] | null
          route_coordinates?: Json | null
          scheduled_for?: string | null
          search_radius_km?: number | null
          search_started_at?: string | null
          start_time: string
          status: string
          total_price_cents?: number | null
          updated_at?: string
          walk_type: string
          walker_id?: string | null
          walker_name?: string | null
        }
        Update: {
          actual_duration_minutes?: number | null
          arrived_at?: string | null
          created_at?: string
          current_radius_meters?: number | null
          current_status?: Database["public"]["Enums"]["walk_status"]
          customer_id?: string
          distance_km?: number | null
          e2e_run_id?: string | null
          e2e_test?: boolean | null
          end_time?: string | null
          feedback?: string | null
          heading_started_at?: string | null
          home_location?: Json | null
          id?: string
          last_expansion_at?: string | null
          last_tracking_at?: string | null
          local_stops?: Json | null
          matching_expires_at?: string | null
          meeting_point_address?: string | null
          meeting_point_geom?: unknown
          meeting_point_location?: unknown
          pet_id?: string
          pet_ids?: string[] | null
          petwalker_notified_at?: string | null
          pickup_confirmed_at?: string | null
          planned_duration_minutes?: number
          price_per_minute_cents?: number | null
          pricing_surcharge_cents?: number | null
          pricing_version?: number | null
          rating?: number | null
          request_mode?: Database["public"]["Enums"]["walk_request_mode"] | null
          route_coordinates?: Json | null
          scheduled_for?: string | null
          search_radius_km?: number | null
          search_started_at?: string | null
          start_time?: string
          status?: string
          total_price_cents?: number | null
          updated_at?: string
          walk_type?: string
          walker_id?: string | null
          walker_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "walk_sessions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "walk_sessions_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "walk_sessions_walker_id_fkey"
            columns: ["walker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      walker_tracking: {
        Row: {
          accuracy: number | null
          captured_at: number | null
          created_at: string | null
          heading: number | null
          id: string
          is_simulated: boolean | null
          location: unknown
          speed: number | null
          walk_session_id: string | null
          walker_id: string
        }
        Insert: {
          accuracy?: number | null
          captured_at?: number | null
          created_at?: string | null
          heading?: number | null
          id?: string
          is_simulated?: boolean | null
          location: unknown
          speed?: number | null
          walk_session_id?: string | null
          walker_id: string
        }
        Update: {
          accuracy?: number | null
          captured_at?: number | null
          created_at?: string | null
          heading?: number | null
          id?: string
          is_simulated?: boolean | null
          location?: unknown
          speed?: number | null
          walk_session_id?: string | null
          walker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "walker_tracking_walk_session_id_fkey"
            columns: ["walk_session_id"]
            isOneToOne: false
            referencedRelation: "walk_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "walker_tracking_walker_id_fkey"
            columns: ["walker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      geography_columns: {
        Row: {
          coord_dimension: number | null
          f_geography_column: unknown
          f_table_catalog: unknown
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Relationships: []
      }
      geometry_columns: {
        Row: {
          coord_dimension: number | null
          f_geometry_column: unknown
          f_table_catalog: string | null
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Insert: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Update: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _postgis_deprecate: {
        Args: { newname: string; oldname: string; version: string }
        Returns: undefined
      }
      _postgis_index_extent: {
        Args: { col: string; tbl: unknown }
        Returns: unknown
      }
      _postgis_pgsql_version: { Args: never; Returns: string }
      _postgis_scripts_pgsql_version: { Args: never; Returns: string }
      _postgis_selectivity: {
        Args: { att_name: string; geom: unknown; mode?: string; tbl: unknown }
        Returns: number
      }
      _postgis_stats: {
        Args: { ""?: string; att_name: string; tbl: unknown }
        Returns: string
      }
      _st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_crosses: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      _st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_intersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      _st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      _st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      _st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_sortablehash: { Args: { geom: unknown }; Returns: number }
      _st_touches: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_voronoi: {
        Args: {
          clip?: unknown
          g1: unknown
          return_polygons?: boolean
          tolerance?: number
        }
        Returns: unknown
      }
      _st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      accept_walk_request: { Args: { _session_id: string }; Returns: boolean }
      addauth: { Args: { "": string }; Returns: boolean }
      addgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              new_dim: number
              new_srid_in: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
      append_walk_tracking_point: {
        Args: { _lat: number; _lng: number; _session_id: string }
        Returns: undefined
      }
      approve_petwalker_application: {
        Args: { application_id: string }
        Returns: undefined
      }
      cancel_walk_session: { Args: { _session_id: string }; Returns: undefined }
      create_walk_request: {
        Args: {
          _duration_minutes: number
          _meeting_point_address: string
          _meeting_point_lat: number
          _meeting_point_lng: number
          _pet_id: string
          _request_mode: Database["public"]["Enums"]["walk_request_mode"]
          _scheduled_for: string
        }
        Returns: string
      }
      customer_cancel_search: {
        Args: { _session_id: string }
        Returns: boolean
      }
      customer_confirm_arrival: {
        Args: { _session_id: string }
        Returns: boolean
      }
      customer_get_pickup_code: {
        Args: { _session_id: string }
        Returns: string
      }
      customer_request_return: {
        Args: { _session_id: string }
        Returns: boolean
      }
      decline_walk_offer: { Args: { _session_id: string }; Returns: boolean }
      disablelongtransactions: { Args: never; Returns: string }
      dropgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { column_name: string; table_name: string }; Returns: string }
      dropgeometrytable:
        | {
            Args: {
              catalog_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { schema_name: string; table_name: string }; Returns: string }
        | { Args: { table_name: string }; Returns: string }
      enablelongtransactions: { Args: never; Returns: string }
      ensure_current_user_profile: { Args: never; Returns: undefined }
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      expand_walk_search_radius: { Args: never; Returns: undefined }
      geometry: { Args: { "": string }; Returns: unknown }
      geometry_above: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_below: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_cmp: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_contained_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_distance_box: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_distance_centroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_eq: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_ge: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_gt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_le: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_left: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_lt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overabove: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overbelow: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overleft: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overright: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_right: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_within: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geomfromewkt: { Args: { "": string }; Returns: unknown }
      get_active_walker_location: {
        Args: { _session_id: string }
        Returns: {
          accuracy: number
          lat: number
          lng: number
          updated_at: string
        }[]
      }
      get_admin_application_stats: {
        Args: never
        Returns: {
          approved_count: number
          pending_count: number
          rejected_count: number
        }[]
      }
      get_available_walk_offers: {
        Args: never
        Returns: {
          created_at: string
          distance_meters: number
          duration_minutes: number
          id: string
          matching_expires_at: string
          offer_status: Database["public"]["Enums"]["walk_offer_status"]
          pet_avatar_url: string
          pet_breed: string
          pet_name: string
          request_mode: string
          scheduled_for: string
          session_id: string
          total_price_cents: number
          walker_id: string
        }[]
      }
      get_petwalker_application_admin: {
        Args: { _application_id: string }
        Returns: {
          birth_date: string
          city: string
          document_status: string
          emergency_contact_name: string
          emergency_contact_phone: string
          experience_description: string
          id: string
          legal_name: string
          phone: string
          rejection_reason: string
          reviewed_at: string
          status: string
          submitted_at: string
        }[]
      }
      get_petwalker_applications_admin: {
        Args: { _status?: string }
        Returns: {
          city: string
          document_status: string
          id: string
          legal_name: string
          reviewed_at: string
          status: string
          submitted_at: string
        }[]
      }
      get_public_petwalker_profiles: {
        Args: never
        Returns: {
          availability_status: string
          avatar_url: string
          completed_walks: number
          experience_years: number
          full_name: string
          is_accepting_requests: boolean
          price_30_minutes: number
          public_bio: string
          rating_average: number
          service_radius_km: number
          user_id: string
        }[]
      }
      get_public_profiles: {
        Args: { user_ids: string[] }
        Returns: {
          avatar_url: string
          bio: string
          full_name: string
          id: string
        }[]
      }
      get_session_walker_profile: {
        Args: { _session_id: string }
        Returns: {
          avatar_url: string
          completed_walks: number
          full_name: string
          rating_average: number
        }[]
      }
      get_walk_quote: {
        Args: {
          _duration_minutes: number
          _request_mode: Database["public"]["Enums"]["walk_request_mode"]
        }
        Returns: {
          duration_minutes: number
          price_per_minute_cents: number
          pricing_version: number
          request_mode: Database["public"]["Enums"]["walk_request_mode"]
          request_surcharge_cents: number
          total_price_cents: number
        }[]
      }
      gettransactionid: { Args: never; Returns: unknown }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_beta_petwalker: { Args: { _user_id: string }; Returns: boolean }
      longtransactionsenabled: { Args: never; Returns: boolean }
      petwalker_arrive_pickup: {
        Args: {
          _accuracy?: number
          _lat: number
          _lng: number
          _session_id: string
        }
        Returns: boolean
      }
      petwalker_complete_walk: {
        Args: { _session_id: string }
        Returns: boolean
      }
      petwalker_confirm_pickup: {
        Args: { input_pin: string; walk_id: string }
        Returns: boolean
      }
      petwalker_start_heading: {
        Args: { _session_id: string }
        Returns: boolean
      }
      populate_geometry_columns:
        | { Args: { tbl_oid: unknown; use_typmod?: boolean }; Returns: number }
        | { Args: { use_typmod?: boolean }; Returns: string }
      postgis_constraint_dims: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_srid: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_type: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: string
      }
      postgis_extensions_upgrade: { Args: never; Returns: string }
      postgis_full_version: { Args: never; Returns: string }
      postgis_geos_version: { Args: never; Returns: string }
      postgis_lib_build_date: { Args: never; Returns: string }
      postgis_lib_revision: { Args: never; Returns: string }
      postgis_lib_version: { Args: never; Returns: string }
      postgis_libjson_version: { Args: never; Returns: string }
      postgis_liblwgeom_version: { Args: never; Returns: string }
      postgis_libprotobuf_version: { Args: never; Returns: string }
      postgis_libxml_version: { Args: never; Returns: string }
      postgis_proj_version: { Args: never; Returns: string }
      postgis_scripts_build_date: { Args: never; Returns: string }
      postgis_scripts_installed: { Args: never; Returns: string }
      postgis_scripts_released: { Args: never; Returns: string }
      postgis_svn_version: { Args: never; Returns: string }
      postgis_type_name: {
        Args: {
          coord_dimension: number
          geomname: string
          use_new_name?: boolean
        }
        Returns: string
      }
      postgis_version: { Args: never; Returns: string }
      postgis_wagyu_version: { Args: never; Returns: string }
      process_walk_matching: { Args: never; Returns: undefined }
      reject_petwalker_application: {
        Args: { _application_id: string; _reason: string }
        Returns: Json
      }
      send_transactional_email: {
        Args: { _html: string; _subject: string; _to: string }
        Returns: Json
      }
      set_petwalker_availability: {
        Args: { _status: string }
        Returns: undefined
      }
      set_signup_intent: {
        Args: { _intent: Database["public"]["Enums"]["signup_intent_type"] }
        Returns: undefined
      }
      st_3dclosestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3ddistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_3dlongestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmakebox: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmaxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dshortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_addpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_angle:
        | { Args: { line1: unknown; line2: unknown }; Returns: number }
        | {
            Args: { pt1: unknown; pt2: unknown; pt3: unknown; pt4?: unknown }
            Returns: number
          }
      st_area:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_asencodedpolyline: {
        Args: { geom: unknown; nprecision?: number }
        Returns: string
      }
      st_asewkt: { Args: { "": string }; Returns: string }
      st_asgeojson:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: {
              geom_column?: string
              maxdecimaldigits?: number
              pretty_bool?: boolean
              r: Record<string, unknown>
            }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_asgml:
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
            }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
      st_askml:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_aslatlontext: {
        Args: { geom: unknown; tmpl?: string }
        Returns: string
      }
      st_asmarc21: { Args: { format?: string; geom: unknown }; Returns: string }
      st_asmvtgeom: {
        Args: {
          bounds: unknown
          buffer?: number
          clip_geom?: boolean
          extent?: number
          geom: unknown
        }
        Returns: unknown
      }
      st_assvg:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_astext: { Args: { "": string }; Returns: string }
      st_astwkb:
        | {
            Args: {
              geom: unknown
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown[]
              ids: number[]
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
      st_asx3d: {
        Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
        Returns: string
      }
      st_azimuth:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: number }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_boundingdiagonal: {
        Args: { fits?: boolean; geom: unknown }
        Returns: unknown
      }
      st_buffer:
        | {
            Args: { geom: unknown; options?: string; radius: number }
            Returns: unknown
          }
        | {
            Args: { geom: unknown; quadsegs: number; radius: number }
            Returns: unknown
          }
      st_centroid: { Args: { "": string }; Returns: unknown }
      st_clipbybox2d: {
        Args: { box: unknown; geom: unknown }
        Returns: unknown
      }
      st_closestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_collect: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_concavehull: {
        Args: {
          param_allow_holes?: boolean
          param_geom: unknown
          param_pctconvex: number
        }
        Returns: unknown
      }
      st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_coorddim: { Args: { geometry: unknown }; Returns: number }
      st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_crosses: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_curvetoline: {
        Args: { flags?: number; geom: unknown; tol?: number; toltype?: number }
        Returns: unknown
      }
      st_delaunaytriangles: {
        Args: { flags?: number; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_difference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_disjoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_distance:
        | {
            Args: { geog1: unknown; geog2: unknown; use_spheroid?: boolean }
            Returns: number
          }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_distancesphere:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | {
            Args: { geom1: unknown; geom2: unknown; radius: number }
            Returns: number
          }
      st_distancespheroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_expand:
        | { Args: { box: unknown; dx: number; dy: number }; Returns: unknown }
        | {
            Args: { box: unknown; dx: number; dy: number; dz?: number }
            Returns: unknown
          }
        | {
            Args: {
              dm?: number
              dx: number
              dy: number
              dz?: number
              geom: unknown
            }
            Returns: unknown
          }
      st_force3d: { Args: { geom: unknown; zvalue?: number }; Returns: unknown }
      st_force3dm: {
        Args: { geom: unknown; mvalue?: number }
        Returns: unknown
      }
      st_force3dz: {
        Args: { geom: unknown; zvalue?: number }
        Returns: unknown
      }
      st_force4d: {
        Args: { geom: unknown; mvalue?: number; zvalue?: number }
        Returns: unknown
      }
      st_generatepoints:
        | { Args: { area: unknown; npoints: number }; Returns: unknown }
        | {
            Args: { area: unknown; npoints: number; seed: number }
            Returns: unknown
          }
      st_geogfromtext: { Args: { "": string }; Returns: unknown }
      st_geographyfromtext: { Args: { "": string }; Returns: unknown }
      st_geohash:
        | { Args: { geog: unknown; maxchars?: number }; Returns: string }
        | { Args: { geom: unknown; maxchars?: number }; Returns: string }
      st_geomcollfromtext: { Args: { "": string }; Returns: unknown }
      st_geometricmedian: {
        Args: {
          fail_if_not_converged?: boolean
          g: unknown
          max_iter?: number
          tolerance?: number
        }
        Returns: unknown
      }
      st_geometryfromtext: { Args: { "": string }; Returns: unknown }
      st_geomfromewkt: { Args: { "": string }; Returns: unknown }
      st_geomfromgeojson:
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": string }; Returns: unknown }
      st_geomfromgml: { Args: { "": string }; Returns: unknown }
      st_geomfromkml: { Args: { "": string }; Returns: unknown }
      st_geomfrommarc21: { Args: { marc21xml: string }; Returns: unknown }
      st_geomfromtext: { Args: { "": string }; Returns: unknown }
      st_gmltosql: { Args: { "": string }; Returns: unknown }
      st_hasarc: { Args: { geometry: unknown }; Returns: boolean }
      st_hausdorffdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_hexagon: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_hexagongrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_interpolatepoint: {
        Args: { line: unknown; point: unknown }
        Returns: number
      }
      st_intersection: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_intersects:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_isvaliddetail: {
        Args: { flags?: number; geom: unknown }
        Returns: Database["public"]["CompositeTypes"]["valid_detail"]
        SetofOptions: {
          from: "*"
          to: "valid_detail"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      st_length:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_letters: { Args: { font?: Json; letters: string }; Returns: unknown }
      st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      st_linefromencodedpolyline: {
        Args: { nprecision?: number; txtin: string }
        Returns: unknown
      }
      st_linefromtext: { Args: { "": string }; Returns: unknown }
      st_linelocatepoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_linetocurve: { Args: { geometry: unknown }; Returns: unknown }
      st_locatealong: {
        Args: { geometry: unknown; leftrightoffset?: number; measure: number }
        Returns: unknown
      }
      st_locatebetween: {
        Args: {
          frommeasure: number
          geometry: unknown
          leftrightoffset?: number
          tomeasure: number
        }
        Returns: unknown
      }
      st_locatebetweenelevations: {
        Args: { fromelevation: number; geometry: unknown; toelevation: number }
        Returns: unknown
      }
      st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makebox2d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makeline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makevalid: {
        Args: { geom: unknown; params: string }
        Returns: unknown
      }
      st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_minimumboundingcircle: {
        Args: { inputgeom: unknown; segs_per_quarter?: number }
        Returns: unknown
      }
      st_mlinefromtext: { Args: { "": string }; Returns: unknown }
      st_mpointfromtext: { Args: { "": string }; Returns: unknown }
      st_mpolyfromtext: { Args: { "": string }; Returns: unknown }
      st_multilinestringfromtext: { Args: { "": string }; Returns: unknown }
      st_multipointfromtext: { Args: { "": string }; Returns: unknown }
      st_multipolygonfromtext: { Args: { "": string }; Returns: unknown }
      st_node: { Args: { g: unknown }; Returns: unknown }
      st_normalize: { Args: { geom: unknown }; Returns: unknown }
      st_offsetcurve: {
        Args: { distance: number; line: unknown; params?: string }
        Returns: unknown
      }
      st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_perimeter: {
        Args: { geog: unknown; use_spheroid?: boolean }
        Returns: number
      }
      st_pointfromtext: { Args: { "": string }; Returns: unknown }
      st_pointm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
        }
        Returns: unknown
      }
      st_pointz: {
        Args: {
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_pointzm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_polyfromtext: { Args: { "": string }; Returns: unknown }
      st_polygonfromtext: { Args: { "": string }; Returns: unknown }
      st_project: {
        Args: { azimuth: number; distance: number; geog: unknown }
        Returns: unknown
      }
      st_quantizecoordinates: {
        Args: {
          g: unknown
          prec_m?: number
          prec_x: number
          prec_y?: number
          prec_z?: number
        }
        Returns: unknown
      }
      st_reduceprecision: {
        Args: { geom: unknown; gridsize: number }
        Returns: unknown
      }
      st_relate: { Args: { geom1: unknown; geom2: unknown }; Returns: string }
      st_removerepeatedpoints: {
        Args: { geom: unknown; tolerance?: number }
        Returns: unknown
      }
      st_segmentize: {
        Args: { geog: unknown; max_segment_length: number }
        Returns: unknown
      }
      st_setsrid:
        | { Args: { geog: unknown; srid: number }; Returns: unknown }
        | { Args: { geom: unknown; srid: number }; Returns: unknown }
      st_sharedpaths: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_shortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_simplifypolygonhull: {
        Args: { geom: unknown; is_outer?: boolean; vertex_fraction: number }
        Returns: unknown
      }
      st_split: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_square: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_squaregrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_srid:
        | { Args: { geog: unknown }; Returns: number }
        | { Args: { geom: unknown }; Returns: number }
      st_subdivide: {
        Args: { geom: unknown; gridsize?: number; maxvertices?: number }
        Returns: unknown[]
      }
      st_swapordinates: {
        Args: { geom: unknown; ords: unknown }
        Returns: unknown
      }
      st_symdifference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_symmetricdifference: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_tileenvelope: {
        Args: {
          bounds?: unknown
          margin?: number
          x: number
          y: number
          zoom: number
        }
        Returns: unknown
      }
      st_touches: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_transform:
        | {
            Args: { from_proj: string; geom: unknown; to_proj: string }
            Returns: unknown
          }
        | {
            Args: { from_proj: string; geom: unknown; to_srid: number }
            Returns: unknown
          }
        | { Args: { geom: unknown; to_proj: string }; Returns: unknown }
      st_triangulatepolygon: { Args: { g1: unknown }; Returns: unknown }
      st_union:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
        | {
            Args: { geom1: unknown; geom2: unknown; gridsize: number }
            Returns: unknown
          }
      st_voronoilines: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_voronoipolygons: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_wkbtosql: { Args: { wkb: string }; Returns: unknown }
      st_wkttosql: { Args: { "": string }; Returns: unknown }
      st_wrapx: {
        Args: { geom: unknown; move: number; wrap: number }
        Returns: unknown
      }
      unlockrows: { Args: { "": string }; Returns: number }
      update_petwalker_operational_profile: {
        Args: { _experience_years: number; _public_bio: string }
        Returns: undefined
      }
      update_walker_location: {
        Args: {
          _accuracy: number
          _captured_at: number
          _lat: number
          _lng: number
        }
        Returns: boolean
      }
      updategeometrysrid: {
        Args: {
          catalogn_name: string
          column_name: string
          new_srid_in: number
          schema_name: string
          table_name: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user" | "petshop" | "petwalker"
      application_status: "pending" | "approved" | "rejected"
      signup_intent_type: "pet_owner" | "petwalker"
      walk_offer_status: "pending" | "accepted" | "declined" | "expired"
      walk_request_mode: "now" | "scheduled"
      walk_session_status:
        | "searching"
        | "offered"
        | "accepted"
        | "heading_to_pickup"
        | "arrived"
        | "in_progress"
        | "completed"
        | "cancelled"
        | "expired"
      walk_status:
        | "searching"
        | "offered"
        | "accepted"
        | "heading_to_pickup"
        | "arrived"
        | "in_progress"
        | "returning"
        | "completed"
        | "cancelled"
        | "expired"
        | "scheduled"
    }
    CompositeTypes: {
      geometry_dump: {
        path: number[] | null
        geom: unknown
      }
      valid_detail: {
        valid: boolean | null
        reason: string | null
        location: unknown
      }
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
      app_role: ["admin", "moderator", "user", "petshop", "petwalker"],
      application_status: ["pending", "approved", "rejected"],
      signup_intent_type: ["pet_owner", "petwalker"],
      walk_offer_status: ["pending", "accepted", "declined", "expired"],
      walk_request_mode: ["now", "scheduled"],
      walk_session_status: [
        "searching",
        "offered",
        "accepted",
        "heading_to_pickup",
        "arrived",
        "in_progress",
        "completed",
        "cancelled",
        "expired",
      ],
      walk_status: [
        "searching",
        "offered",
        "accepted",
        "heading_to_pickup",
        "arrived",
        "in_progress",
        "returning",
        "completed",
        "cancelled",
        "expired",
        "scheduled",
      ],
    },
  },
} as const
