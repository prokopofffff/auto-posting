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
          extensions?: Json
          variables?: Json
          query?: string
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
      AiCredential: {
        Row: {
          apiKey: string | null
          createdAt: string
          createdBy: string | null
          deepseekApiKey: string | null
          id: string
          mode: Database["public"]["Enums"]["AiCredentialMode"]
          model: string | null
          oauthAccessToken: string | null
          oauthExpiresAt: string | null
          oauthRefreshToken: string | null
          projectId: string
          provider: Database["public"]["Enums"]["AiProvider"]
          updatedAt: string
        }
        Insert: {
          apiKey?: string | null
          createdAt?: string
          createdBy?: string | null
          deepseekApiKey?: string | null
          id?: string
          mode?: Database["public"]["Enums"]["AiCredentialMode"]
          model?: string | null
          oauthAccessToken?: string | null
          oauthExpiresAt?: string | null
          oauthRefreshToken?: string | null
          projectId: string
          provider?: Database["public"]["Enums"]["AiProvider"]
          updatedAt?: string
        }
        Update: {
          apiKey?: string | null
          createdAt?: string
          createdBy?: string | null
          deepseekApiKey?: string | null
          id?: string
          mode?: Database["public"]["Enums"]["AiCredentialMode"]
          model?: string | null
          oauthAccessToken?: string | null
          oauthExpiresAt?: string | null
          oauthRefreshToken?: string | null
          projectId?: string
          provider?: Database["public"]["Enums"]["AiProvider"]
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "AiCredential_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: true
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AiCredential_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "User"
            referencedColumns: ["id"]
          },
        ]
      }
      ConnectedAccount: {
        Row: {
          accessToken: string | null
          createdAt: string
          displayName: string | null
          expiresAt: string | null
          externalId: string
          id: string
          meta: Json | null
          platform: Database["public"]["Enums"]["Platform"]
          projectId: string
          refreshToken: string | null
          updatedAt: string
        }
        Insert: {
          accessToken?: string | null
          createdAt?: string
          displayName?: string | null
          expiresAt?: string | null
          externalId: string
          id?: string
          meta?: Json | null
          platform: Database["public"]["Enums"]["Platform"]
          projectId: string
          refreshToken?: string | null
          updatedAt?: string
        }
        Update: {
          accessToken?: string | null
          createdAt?: string
          displayName?: string | null
          expiresAt?: string | null
          externalId?: string
          id?: string
          meta?: Json | null
          platform?: Database["public"]["Enums"]["Platform"]
          projectId?: string
          refreshToken?: string | null
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "ConnectedAccount_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
        ]
      }
      Draft: {
        Row: {
          confidence: number | null
          contentByLang: Json
          contentByPlatform: Json | null
          corroboratingSources: string[]
          costUsd: number | null
          createdAt: string
          factVerdict: Database["public"]["Enums"]["FactVerdict"] | null
          id: string
          imageUrl: string | null
          projectId: string
          scheduledAt: string | null
          sourceTitle: string | null
          sourceTrust: number | null
          sourceUrl: string | null
          status: Database["public"]["Enums"]["DraftStatus"]
          targets: Database["public"]["Enums"]["Platform"][] | null
          tokensInput: number | null
          tokensOutput: number | null
          topic: string
          updatedAt: string
        }
        Insert: {
          confidence?: number | null
          contentByLang: Json
          contentByPlatform?: Json | null
          corroboratingSources?: string[]
          costUsd?: number | null
          createdAt?: string
          factVerdict?: Database["public"]["Enums"]["FactVerdict"] | null
          id?: string
          imageUrl?: string | null
          projectId: string
          scheduledAt?: string | null
          sourceTitle?: string | null
          sourceTrust?: number | null
          sourceUrl?: string | null
          status?: Database["public"]["Enums"]["DraftStatus"]
          targets?: Database["public"]["Enums"]["Platform"][] | null
          tokensInput?: number | null
          tokensOutput?: number | null
          topic: string
          updatedAt?: string
        }
        Update: {
          confidence?: number | null
          contentByLang?: Json
          contentByPlatform?: Json | null
          corroboratingSources?: string[]
          costUsd?: number | null
          createdAt?: string
          factVerdict?: Database["public"]["Enums"]["FactVerdict"] | null
          id?: string
          imageUrl?: string | null
          projectId?: string
          scheduledAt?: string | null
          sourceTitle?: string | null
          sourceTrust?: number | null
          sourceUrl?: string | null
          status?: Database["public"]["Enums"]["DraftStatus"]
          targets?: Database["public"]["Enums"]["Platform"][] | null
          tokensInput?: number | null
          tokensOutput?: number | null
          topic?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "Draft_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
        ]
      }
      Organization: {
        Row: {
          createdAt: string
          id: string
          name: string
          ownerId: string
          plan: Database["public"]["Enums"]["Plan"]
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          id?: string
          name: string
          ownerId: string
          plan?: Database["public"]["Enums"]["Plan"]
          updatedAt?: string
        }
        Update: {
          createdAt?: string
          id?: string
          name?: string
          ownerId?: string
          plan?: Database["public"]["Enums"]["Plan"]
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "Organization_ownerId_fkey"
            columns: ["ownerId"]
            isOneToOne: false
            referencedRelation: "User"
            referencedColumns: ["id"]
          },
        ]
      }
      OrganizationMember: {
        Row: {
          id: string
          joined: string
          orgId: string
          role: Database["public"]["Enums"]["OrgRole"]
          userId: string
        }
        Insert: {
          id?: string
          joined?: string
          orgId: string
          role?: Database["public"]["Enums"]["OrgRole"]
          userId: string
        }
        Update: {
          id?: string
          joined?: string
          orgId?: string
          role?: Database["public"]["Enums"]["OrgRole"]
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "OrganizationMember_orgId_fkey"
            columns: ["orgId"]
            isOneToOne: false
            referencedRelation: "Organization"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "OrganizationMember_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "User"
            referencedColumns: ["id"]
          },
        ]
      }
      Post: {
        Row: {
          content: string
          draftId: string | null
          error: string | null
          externalId: string | null
          externalUrl: string | null
          id: string
          imageUrl: string | null
          language: string
          platform: Database["public"]["Enums"]["Platform"]
          projectId: string
          publishedAt: string
        }
        Insert: {
          content: string
          draftId?: string | null
          error?: string | null
          externalId?: string | null
          externalUrl?: string | null
          id?: string
          imageUrl?: string | null
          language: string
          platform: Database["public"]["Enums"]["Platform"]
          projectId: string
          publishedAt?: string
        }
        Update: {
          content?: string
          draftId?: string | null
          error?: string | null
          externalId?: string | null
          externalUrl?: string | null
          id?: string
          imageUrl?: string | null
          language?: string
          platform?: Database["public"]["Enums"]["Platform"]
          projectId?: string
          publishedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "Post_draftId_fkey"
            columns: ["draftId"]
            isOneToOne: false
            referencedRelation: "Draft"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Post_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
        ]
      }
      Project: {
        Row: {
          createdAt: string
          id: string
          name: string
          orgId: string
          status: Database["public"]["Enums"]["ProjectStatus"]
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          id?: string
          name: string
          orgId: string
          status?: Database["public"]["Enums"]["ProjectStatus"]
          updatedAt?: string
        }
        Update: {
          createdAt?: string
          id?: string
          name?: string
          orgId?: string
          status?: Database["public"]["Enums"]["ProjectStatus"]
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "Project_orgId_fkey"
            columns: ["orgId"]
            isOneToOne: false
            referencedRelation: "Organization"
            referencedColumns: ["id"]
          },
        ]
      }
      ProjectSettings: {
        Row: {
          angle: string | null
          audience: string | null
          bannedWords: string[] | null
          confidenceThreshold: number
          customStyle: string | null
          id: string
          includeHashtags: boolean
          includeSource: boolean
          intervalDays: number
          languages: string[] | null
          maxPostChars: number
          mode: Database["public"]["Enums"]["PostMode"]
          moderationEnabled: boolean
          preferredHour: number
          projectId: string
          scheduleCron: string | null
          skipDays: number[] | null
          timezone: string
          topics: string[] | null
          voiceMode: Database["public"]["Enums"]["VoiceMode"]
          voiceOverrides: Json | null
          writingStyle: string
        }
        Insert: {
          angle?: string | null
          audience?: string | null
          bannedWords?: string[] | null
          confidenceThreshold?: number
          customStyle?: string | null
          id?: string
          includeHashtags?: boolean
          includeSource?: boolean
          intervalDays?: number
          languages?: string[] | null
          maxPostChars?: number
          mode?: Database["public"]["Enums"]["PostMode"]
          moderationEnabled?: boolean
          preferredHour?: number
          projectId: string
          scheduleCron?: string | null
          skipDays?: number[] | null
          timezone?: string
          topics?: string[] | null
          voiceMode?: Database["public"]["Enums"]["VoiceMode"]
          voiceOverrides?: Json | null
          writingStyle?: string
        }
        Update: {
          angle?: string | null
          audience?: string | null
          bannedWords?: string[] | null
          confidenceThreshold?: number
          customStyle?: string | null
          id?: string
          includeHashtags?: boolean
          includeSource?: boolean
          intervalDays?: number
          languages?: string[] | null
          maxPostChars?: number
          mode?: Database["public"]["Enums"]["PostMode"]
          moderationEnabled?: boolean
          preferredHour?: number
          projectId?: string
          scheduleCron?: string | null
          skipDays?: number[] | null
          timezone?: string
          topics?: string[] | null
          voiceMode?: Database["public"]["Enums"]["VoiceMode"]
          voiceOverrides?: Json | null
          writingStyle?: string
        }
        Relationships: [
          {
            foreignKeyName: "ProjectSettings_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: true
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
        ]
      }
      RateLimit: {
        Row: {
          attempts: number
          key: string
          lockedUntil: number
          namespace: string
          windowStart: number
        }
        Insert: {
          attempts?: number
          key: string
          lockedUntil?: number
          namespace: string
          windowStart: number
        }
        Update: {
          attempts?: number
          key?: string
          lockedUntil?: number
          namespace?: string
          windowStart?: number
        }
        Relationships: []
      }
      User: {
        Row: {
          createdAt: string
          email: string
          emailVerified: string | null
          id: string
          image: string | null
          name: string | null
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          email: string
          emailVerified?: string | null
          id?: string
          image?: string | null
          name?: string | null
          updatedAt?: string
        }
        Update: {
          createdAt?: string
          email?: string
          emailVerified?: string | null
          id?: string
          image?: string | null
          name?: string | null
          updatedAt?: string
        }
        Relationships: []
      }
    }
    Views: {
      DraftStatusCount: {
        Row: {
          count: number | null
          projectId: string | null
          status: Database["public"]["Enums"]["DraftStatus"] | null
        }
        Relationships: [
          {
            foreignKeyName: "Draft_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      current_user_org_ids: {
        Args: Record<PropertyKey, never>
        Returns: string[]
      }
      draft_spend_30d: {
        Args: { p_project_id: string; p_days?: number }
        Returns: {
          costUsd: number
          tokensInput: number
          tokensOutput: number
        }[]
      }
      rate_limit_record_failure: {
        Args: {
          p_window_ms: number
          p_max_attempts: number
          p_lockout_ms: number
          p_namespace: string
          p_key: string
          p_now: number
        }
        Returns: number
      }
      save_project_settings: {
        Args: { p_project_id: string; p_name: string; p_settings: Json }
        Returns: undefined
      }
    }
    Enums: {
      AiCredentialMode: "API_KEY" | "SUBSCRIPTION"
      AiProvider: "ANTHROPIC" | "DEEPSEEK"
      DraftStatus:
        | "PENDING"
        | "APPROVED"
        | "SCHEDULED"
        | "PUBLISHED"
        | "FAILED"
        | "SKIPPED"
      FactVerdict: "TRUSTED" | "CORROBORATED" | "UNVERIFIED"
      OrgRole: "OWNER" | "ADMIN" | "MEMBER"
      Plan: "FREE" | "PRO" | "TEAM"
      Platform: "LINKEDIN" | "TELEGRAM"
      PostMode: "MANUAL" | "AUTOPILOT" | "HYBRID"
      ProjectStatus: "ACTIVE" | "PAUSED"
      VoiceMode: "UNIFIED" | "PER_PLATFORM"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      AiCredentialMode: ["API_KEY", "SUBSCRIPTION"],
      AiProvider: ["ANTHROPIC", "DEEPSEEK"],
      DraftStatus: [
        "PENDING",
        "APPROVED",
        "SCHEDULED",
        "PUBLISHED",
        "FAILED",
        "SKIPPED",
      ],
      FactVerdict: ["TRUSTED", "CORROBORATED", "UNVERIFIED"],
      OrgRole: ["OWNER", "ADMIN", "MEMBER"],
      Plan: ["FREE", "PRO", "TEAM"],
      Platform: ["LINKEDIN", "TELEGRAM"],
      PostMode: ["MANUAL", "AUTOPILOT", "HYBRID"],
      ProjectStatus: ["ACTIVE", "PAUSED"],
      VoiceMode: ["UNIFIED", "PER_PLATFORM"],
    },
  },
} as const

