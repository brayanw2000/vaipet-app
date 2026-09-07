import React from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Bell } from 'lucide-react';
import logoAsset from "@/assets/vaipet-logo-new.png.asset.json";

export const PetshopHeader = () => {
  const { profile } = useAuth();

  return (
    <div className="bg-card border-b border-border px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Avatar className="h-10 w-10">
            <AvatarImage src={profile?.avatar_url} />
            <AvatarFallback className="bg-primary text-primary-foreground">
              {profile?.full_name?.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div>
            <img src="/vaipet-logo.svg" alt="VaiPet" className="w-20 h-auto mb-0.5" />
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-tight">{profile?.full_name}</p>
          </div>
        </div>
        
        <button className="p-2 rounded-lg hover:bg-muted transition-colors">
          <Bell size={20} className="text-muted-foreground" />
        </button>
      </div>
    </div>
  );
};