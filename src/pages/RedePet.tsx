import React, { useEffect, useState } from 'react';
import { BottomNavigation } from '@/components/BottomNavigation';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Heart, MessageCircle, Send, ImagePlus, Trash2, ArrowLeft, PawPrint, Share2 } from 'lucide-react';
import { share as nativeShare, haptic } from '@/lib/native';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useHomeTheme } from '@/hooks/useHomeTheme';

const BRAND = '#31D880';

// Promo banner slider — empty placeholders, ready to receive real images later.
const PROMO_SLIDES: { id: string; bg: string }[] = [
  { id: 'p1', bg: '#0B1410' },
  { id: 'p2', bg: BRAND },
  { id: 'p3', bg: '#E4FF7A' },
];

interface Post {
  id: string;
  user_id: string;
  content: string;
  image_url: string | null;
  likes_count: number;
  created_at: string;
  profile?: { full_name: string | null; avatar_url: string | null };
  liked_by_me?: boolean;
  comments_count?: number;
}

interface Comment {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  profile?: { full_name: string | null; avatar_url: string | null };
}

const RedePet = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { palette } = useHomeTheme();
  const PAPER = palette.paper;
  const INK = palette.ink;
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [newPost, setNewPost] = useState('');
  const [posting, setPosting] = useState(false);
  const [expandedComments, setExpandedComments] = useState<string | null>(null);
  const [comments, setComments] = useState<{ [postId: string]: Comment[] }>({});
  const [newComment, setNewComment] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');
  const imageInputRef = React.useRef<HTMLInputElement>(null);
  const [promoIndex, setPromoIndex] = useState(0);
  const promoScrollRef = React.useRef<HTMLDivElement>(null);

  const onPromoScroll = () => {
    const el = promoScrollRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    if (idx !== promoIndex) setPromoIndex(idx);
  };

  useEffect(() => {
    fetchPosts();
  }, [user]);

  const fetchPosts = async () => {
    try {
      const { data: postsData, error } = await supabase
        .from('posts')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      if (!postsData) { setPosts([]); return; }

      const userIds = [...new Set(postsData.map(p => p.user_id))];
      const { data: profilesData } = await supabase.rpc('get_public_profiles', { user_ids: userIds });

      let myLikes: string[] = [];
      if (user) {
        const { data: likesData } = await supabase
          .from('post_likes')
          .select('post_id')
          .eq('user_id', user.id);
        myLikes = likesData?.map(l => l.post_id) || [];
      }

      const postIds = postsData.map(p => p.id);
      const { data: commentsCount } = await supabase
        .from('post_comments')
        .select('post_id')
        .in('post_id', postIds);

      const commentCounts: { [id: string]: number } = {};
      commentsCount?.forEach(c => {
        commentCounts[c.post_id] = (commentCounts[c.post_id] || 0) + 1;
      });

      const enriched = postsData.map(post => ({
        ...post,
        profile: profilesData?.find(p => p.id === post.user_id) || undefined,
        liked_by_me: myLikes.includes(post.id),
        comments_count: commentCounts[post.id] || 0,
      }));

      setPosts(enriched);
    } catch (error) {
      console.error('Error fetching posts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) { toast.error('Máximo 5MB'); return; }
      setImageFile(file);
      const reader = new FileReader();
      reader.onload = (ev) => setImagePreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handlePost = async () => {
    if (!newPost.trim() || !user) return;
    setPosting(true);
    try {
      let imageUrl: string | null = null;

      if (imageFile) {
        const fileExt = imageFile.name.split('.').pop();
        const fileName = `${user.id}/posts/${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from('pet-photos')
          .upload(fileName, imageFile);
        if (!uploadError) {
          const { data } = supabase.storage.from('pet-photos').getPublicUrl(fileName);
          imageUrl = data.publicUrl;
        }
      }

      const { error } = await supabase.from('posts').insert({
        user_id: user.id,
        content: newPost.trim(),
        image_url: imageUrl,
      });
      if (error) throw error;
      setNewPost('');
      setImageFile(null);
      setImagePreview('');
      fetchPosts();
      toast.success('Publicação criada! 🐾');
    } catch (error) {
      console.error(error);
      toast.error('Erro ao publicar');
    } finally {
      setPosting(false);
    }
  };

  const handleLike = async (postId: string, likedByMe: boolean) => {
    if (!user) { toast.error('Faça login para curtir'); return; }
    try {
      if (likedByMe) {
        await supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', user.id);
      } else {
        await supabase.from('post_likes').insert({ post_id: postId, user_id: user.id });
      }
      setPosts(prev => prev.map(p =>
        p.id === postId
          ? { ...p, liked_by_me: !likedByMe, likes_count: likedByMe ? p.likes_count - 1 : p.likes_count + 1 }
          : p
      ));
    } catch (error) {
      console.error(error);
    }
  };

  const handleDeletePost = async (postId: string) => {
    if (!user) return;
    try {
      await supabase.from('posts').delete().eq('id', postId).eq('user_id', user.id);
      setPosts(prev => prev.filter(p => p.id !== postId));
      toast.success('Publicação removida');
    } catch (error) {
      console.error(error);
    }
  };

  const toggleComments = async (postId: string) => {
    if (expandedComments === postId) {
      setExpandedComments(null);
      return;
    }
    setExpandedComments(postId);
    if (!comments[postId]) {
      const { data } = await supabase
        .from('post_comments')
        .select('*')
        .eq('post_id', postId)
        .order('created_at', { ascending: true });
      if (data) {
        const userIds = [...new Set(data.map(c => c.user_id))];
        const { data: profiles } = await supabase.rpc('get_public_profiles', { user_ids: userIds });
        const enriched = data.map(c => ({
          ...c,
          profile: profiles?.find(p => p.id === c.user_id) || undefined,
        }));
        setComments(prev => ({ ...prev, [postId]: enriched }));
      }
    }
  };

  const handleComment = async (postId: string) => {
    if (!newComment.trim() || !user) return;
    try {
      const { data, error } = await supabase
        .from('post_comments')
        .insert({ post_id: postId, user_id: user.id, content: newComment.trim() })
        .select()
        .single();
      if (error) throw error;
      const newC: Comment = { ...data, profile: { full_name: profile?.full_name || null, avatar_url: profile?.avatar_url || null } };
      setComments(prev => ({ ...prev, [postId]: [...(prev[postId] || []), newC] }));
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, comments_count: (p.comments_count || 0) + 1 } : p));
      setNewComment('');
    } catch (error) {
      console.error(error);
    }
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'agora';
    if (mins < 60) return `${mins}min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  };

  const Avatar = ({ url, name, size = 'md' }: { url?: string | null; name?: string | null; size?: 'sm' | 'md' | 'lg' }) => {
    const sizeClasses = { sm: 'w-7 h-7 text-[10px]', md: 'w-10 h-10 text-sm', lg: 'w-12 h-12 text-base' };
    return (
      <div className={`${sizeClasses[size]} rounded-full flex-shrink-0 overflow-hidden bg-accent/15`}>
        {url ? (
          <img src={url} className="w-full h-full object-cover" alt="" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-accent font-bold">
            {name?.charAt(0)?.toUpperCase() || '?'}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="min-h-screen flex flex-col max-w-md mx-auto relative"
      style={{ background: PAPER, color: INK, fontFamily: 'DM Sans, sans-serif' }}
    >
      <div className="flex-1 pb-24">
        {/* Editorial header */}
        <div
          className="sticky top-0 z-30 backdrop-blur-xl"
          style={{
            background: `${PAPER}E6`,
            borderBottom: `1px solid ${INK}14`,
          }}
        >
          <div className="px-5 pt-6 pb-3 flex items-center justify-between">
            <button
              onClick={() => navigate('/')}
              aria-label="Voltar"
              className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform"
              style={{ border: `1px solid ${INK}26`, color: INK }}
            >
              <ArrowLeft className="w-4 h-4" strokeWidth={2.2} />
            </button>
            <span
              className="text-[10px] font-bold uppercase tracking-[0.28em]"
              style={{ opacity: 0.55 }}
            >
              Comunidade
            </span>
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: BRAND, color: '#0B1410' }}
            >
              <PawPrint className="w-4 h-4" strokeWidth={2.4} />
            </div>
          </div>
          <div className="px-5 pb-4">
            <h1
              className="font-bold leading-[0.92]"
              style={{
                fontFamily: 'Space Grotesk, sans-serif',
                fontSize: 'clamp(34px, 10.5vw, 44px)',
                letterSpacing: '-0.04em',
              }}
            >
              Rede Pet
            </h1>
            <p className="mt-2 text-[12.5px]" style={{ opacity: 0.6 }}>
              Compartilhe momentos com a comunidade.
            </p>
          </div>
        </div>

        {/* Promo slider placeholders */}
        <div className="pt-4">
          <div
            ref={promoScrollRef}
            onScroll={onPromoScroll}
            className="flex overflow-x-auto scrollbar-hide snap-x snap-mandatory px-5 gap-3"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            {PROMO_SLIDES.map((slide) => (
              <div
                key={slide.id}
                className="snap-start flex-shrink-0 w-full relative overflow-hidden"
                style={{
                  background: slide.bg,
                  borderRadius: 26,
                  minHeight: 160,
                }}
              />
            ))}
          </div>
          {/* Pagination dots */}
          <div className="flex justify-center gap-1.5 mt-3">
            {PROMO_SLIDES.map((_, i) => (
              <span
                key={i}
                className="block rounded-full transition-all"
                style={{
                  width: promoIndex === i ? 18 : 6,
                  height: 6,
                  background: promoIndex === i ? INK : `${INK}33`,
                }}
              />
            ))}
          </div>
        </div>

        <div className="px-4 pt-4">
          {/* Compose card */}
          {user && (
            <div className="bg-card rounded-3xl p-4 mb-5 border border-border/50 shadow-sm animate-fade-in">
              <div className="flex items-start gap-3">
                <Avatar url={profile?.avatar_url} name={profile?.full_name} />
                <div className="flex-1">
                  <textarea
                    value={newPost}
                    onChange={(e) => setNewPost(e.target.value)}
                    placeholder="O que seu pet aprontou hoje? 🐾"
                    className="w-full bg-transparent text-sm text-foreground resize-none outline-none min-h-[50px] placeholder:text-muted-foreground/60"
                    rows={2}
                  />

                  {/* Image preview */}
                  {imagePreview && (
                    <div className="relative mt-2 mb-2">
                      <img src={imagePreview} className="w-full rounded-2xl max-h-40 object-cover" alt="" />
                      <button
                        onClick={() => { setImageFile(null); setImagePreview(''); }}
                        className="absolute top-2 right-2 w-6 h-6 bg-foreground/60 text-background rounded-full flex items-center justify-center text-xs"
                      >
                        ×
                      </button>
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/40">
                    <button 
                      onClick={() => imageInputRef.current?.click()}
                      className="p-2 rounded-xl hover:bg-muted text-muted-foreground active:scale-95 transition-all"
                    >
                      <ImagePlus className="w-5 h-5" />
                    </button>
                    <input ref={imageInputRef} type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
                    <button
                      onClick={handlePost}
                      disabled={!newPost.trim() || posting}
                      className="px-5 py-2 rounded-full text-accent-foreground text-xs font-bold disabled:opacity-40 active:scale-95 transition-all bg-accent shadow-sm shadow-accent/20"
                    >
                      {posting ? (
                        <span className="flex items-center gap-1.5">
                          <span className="w-3 h-3 border-2 border-accent-foreground/30 border-t-accent-foreground rounded-full animate-spin" />
                          Postando...
                        </span>
                      ) : 'Publicar'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Feed */}
          {loading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="bg-card rounded-3xl h-36 animate-pulse border border-border/30" />
              ))}
            </div>
          ) : posts.length === 0 ? (
            <div className="text-center py-20 animate-fade-in">
              <div className="w-20 h-20 rounded-3xl mx-auto flex items-center justify-center mb-4 bg-accent/10">
                <span className="text-3xl">🐾</span>
              </div>
              <h3 className="font-bold text-foreground mb-2 text-lg">Nenhuma publicação</h3>
              <p className="text-sm text-muted-foreground max-w-[240px] mx-auto">Seja o primeiro a compartilhar um momento com seu pet!</p>
            </div>
          ) : (
            <div className="space-y-4">
              {posts.map((post, index) => (
                <div 
                  key={post.id} 
                  className="bg-card rounded-3xl p-4 border border-border/40 shadow-sm animate-fade-in"
                  style={{ animationDelay: `${index * 60}ms`, animationFillMode: 'both' }}
                >
                  {/* Author */}
                  <div className="flex items-center gap-3 mb-3">
                    <Avatar url={post.profile?.avatar_url} name={post.profile?.full_name} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-foreground truncate">{post.profile?.full_name || 'Usuário'}</p>
                      <p className="text-[11px] text-muted-foreground">{timeAgo(post.created_at)}</p>
                    </div>
                    {user?.id === post.user_id && (
                      <button 
                        onClick={() => handleDeletePost(post.id)} 
                        className="p-2 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 active:scale-95 transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {/* Content */}
                  <p className="text-sm text-foreground leading-relaxed mb-3 whitespace-pre-wrap">{post.content}</p>

                  {post.image_url && (
                    <img src={post.image_url} className="w-full rounded-2xl mb-3 object-cover max-h-72" alt="" />
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-1 pt-2 border-t border-border/30">
                    <button
                      onClick={() => handleLike(post.id, !!post.liked_by_me)}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm transition-all active:scale-95 ${
                        post.liked_by_me 
                          ? 'text-accent bg-accent/10 font-semibold' 
                          : 'text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      <Heart className={`w-4 h-4 transition-all ${post.liked_by_me ? 'fill-current scale-110' : ''}`} />
                      <span>{post.likes_count || ''}</span>
                    </button>
                    <button
                      onClick={() => toggleComments(post.id)}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm transition-all active:scale-95 ${
                        expandedComments === post.id 
                          ? 'text-primary bg-primary/10 font-semibold'
                          : 'text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      <MessageCircle className="w-4 h-4" />
                      <span>{post.comments_count || ''}</span>
                    </button>
                    <button
                      onClick={async () => {
                        haptic.light();
                        await nativeShare({
                          title: 'VaiPet — Rede Pet',
                          text: post.content || `Confira esse momento na Rede Pet do VaiPet!`,
                          url: `${window.location.origin}/rede-pet`,
                          dialogTitle: 'Compartilhar momento',
                        });
                      }}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:bg-muted transition-all active:scale-95 ml-auto"
                      aria-label="Compartilhar"
                    >
                      <Share2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Comments */}
                  {expandedComments === post.id && (
                    <div className="mt-3 pt-3 border-t border-border/30 space-y-3 animate-fade-in">
                      {comments[post.id]?.length === 0 && (
                        <p className="text-xs text-muted-foreground text-center py-2">Nenhum comentário ainda</p>
                      )}
                      {comments[post.id]?.map((comment) => (
                        <div key={comment.id} className="flex gap-2 animate-fade-in">
                          <Avatar url={comment.profile?.avatar_url} name={comment.profile?.full_name} size="sm" />
                          <div className="flex-1 bg-muted/50 rounded-2xl px-3 py-2">
                            <div className="flex items-center gap-2">
                              <p className="text-xs font-bold text-foreground">{comment.profile?.full_name || 'Usuário'}</p>
                              <p className="text-[10px] text-muted-foreground">{timeAgo(comment.created_at)}</p>
                            </div>
                            <p className="text-xs text-foreground mt-0.5 leading-relaxed">{comment.content}</p>
                          </div>
                        </div>
                      ))}
                      {user && (
                        <div className="flex items-center gap-2">
                          <Avatar url={profile?.avatar_url} name={profile?.full_name} size="sm" />
                          <div className="flex-1 flex items-center bg-muted/50 rounded-full pl-4 pr-1 py-1">
                            <input
                              value={newComment}
                              onChange={(e) => setNewComment(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleComment(post.id)}
                              placeholder="Comentar..."
                              className="flex-1 bg-transparent text-xs outline-none text-foreground placeholder:text-muted-foreground/60"
                            />
                            <button
                              onClick={() => handleComment(post.id)}
                              disabled={!newComment.trim()}
                              className="p-2 rounded-full text-accent disabled:opacity-30 active:scale-90 transition-all"
                            >
                              <Send className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <BottomNavigation />
    </div>
  );
};

export default RedePet;
