import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ImageUpload } from '@/components/petshop/ImageUpload';
import { toast } from 'sonner';

const productSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  description: z.string().optional(),
  price: z.number().min(0, 'Preço deve ser maior que 0'),
  weight: z.number().optional(),
  dimensions: z.string().optional(),
  origin_city: z.string().optional(),
  category: z.string().optional(),
  is_active: z.boolean(),
  stock_quantity: z.number().min(0, 'Quantidade deve ser maior ou igual a 0'),
});

type ProductFormData = z.infer<typeof productSchema>;

interface ProductFormProps {
  onSuccess: () => void;
  initialData?: Partial<ProductFormData> & { id?: string };
}

export const ProductForm: React.FC<ProductFormProps> = ({ onSuccess, initialData }) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<File[]>([]);
  const [existingImages, setExistingImages] = useState<string[]>([]);

  // Categorias predefinidas para petshop
  const categories = [
    'Ração',
    'Brinquedos',
    'Caminhas',
    'Roupas',
    'Coleiras e Guias',
    'Higiene e Cuidados',
    'Medicamentos',
    'Acessórios',
    'Petiscos',
    'Comedouros e Bebedouros',
    'Transporte',
    'Casa e Canil'
  ];

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: initialData?.name || '',
      description: initialData?.description || '',
      price: initialData?.price || 0,
      weight: initialData?.weight || 0,
      dimensions: initialData?.dimensions || '',
      origin_city: initialData?.origin_city || '',
      category: initialData?.category || '',
      is_active: initialData?.is_active !== undefined ? initialData.is_active : true,
      stock_quantity: initialData?.stock_quantity || 0,
    },
  });

  const isActive = watch('is_active');

  // Carregar imagens existentes quando em modo de edição
  useEffect(() => {
    if (initialData?.id) {
      fetchExistingImages();
    }
  }, [initialData?.id]);

  const fetchExistingImages = async () => {
    if (!initialData?.id) return;

    try {
      const { data, error } = await supabase
        .from('product_images')
        .select('image_url')
        .eq('product_id', initialData.id)
        .order('display_order');

      if (error) throw error;

      setExistingImages(data?.map(img => img.image_url) || []);
    } catch (error) {
      console.error('Error fetching existing images:', error);
    }
  };

  const removeExistingImage = async (imageUrl: string) => {
    try {
      // Remove from database
      const { error } = await supabase
        .from('product_images')
        .delete()
        .eq('product_id', initialData?.id)
        .eq('image_url', imageUrl);

      if (error) throw error;

      // Update local state
      setExistingImages(prev => prev.filter(url => url !== imageUrl));
      toast.success('Imagem removida com sucesso!');
    } catch (error) {
      console.error('Error removing image:', error);
      toast.error('Erro ao remover imagem');
    }
  };

  const onSubmit = async (data: ProductFormData) => {
    if (!user) return;

    try {
      setLoading(true);

      // Create or update product
      const productData = {
        petshop_id: user.id,
        name: data.name,
        description: data.description,
        price: data.price,
        weight: data.weight,
        dimensions: data.dimensions,
        origin_city: data.origin_city,
        category: data.category,
        is_active: data.is_active,
      };

      let productId = initialData?.id;

      if (initialData?.id) {
        // Update existing product
        const { error } = await supabase
          .from('products')
          .update(productData)
          .eq('id', initialData.id);

        if (error) throw error;
      } else {
        // Create new product
        const { data: product, error } = await supabase
          .from('products')
          .insert([productData])
          .select()
          .single();

        if (error) throw error;
        productId = product.id;
      }

      // Handle inventory
      if (initialData?.id) {
        // Para edição, usar upsert com match baseado em product_id
        const { error: inventoryError } = await supabase
          .from('inventory')
          .upsert({
            product_id: productId,
            quantity: data.stock_quantity,
          }, {
            onConflict: 'product_id'
          });

        if (inventoryError) throw inventoryError;
      } else {
        // Para criação, inserir novo registro
        const { error: inventoryError } = await supabase
          .from('inventory')
          .insert({
            product_id: productId,
            quantity: data.stock_quantity,
          });

        if (inventoryError) throw inventoryError;
      }

      // Upload images if any
      if (images.length > 0) {
        for (let i = 0; i < images.length; i++) {
          const file = images[i];
          const fileName = `${productId}_${Date.now()}_${i}.${file.name.split('.').pop()}`;
          const filePath = `${user.id}/products/${productId}/${Date.now()}_${i}.${file.name.split('.').pop()}`;

          const { error: uploadError } = await supabase.storage
            .from('product-images')
            .upload(filePath, file);

          if (uploadError) throw uploadError;

          const { data: { publicUrl } } = supabase.storage
            .from('product-images')
            .getPublicUrl(filePath);

          await supabase
            .from('product_images')
            .insert({
              product_id: productId,
              image_url: publicUrl,
              display_order: i,
            });
        }
      }

      toast.success(initialData?.id ? 'Produto atualizado com sucesso!' : 'Produto criado com sucesso!');
      onSuccess();
    } catch (error) {
      console.error('Error saving product:', error);
      toast.error('Erro ao salvar produto');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <ImageUpload
        images={images}
        onChange={setImages}
        maxImages={10}
        existingImages={existingImages}
        onRemoveExisting={removeExistingImage}
      />

      <div className="space-y-4">
        <div>
          <Label htmlFor="name">Nome do Produto</Label>
          <Input
            id="name"
            {...register('name')}
            placeholder="Digite o nome do produto"
          />
          {errors.name && (
            <p className="text-sm text-destructive mt-1">{errors.name.message}</p>
          )}
        </div>

        <div>
          <Label htmlFor="description">Descrição</Label>
          <Textarea
            id="description"
            {...register('description')}
            placeholder="Descreva o produto"
            rows={3}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="price">Preço (R$)</Label>
            <Input
              id="price"
              type="number"
              step="0.01"
              {...register('price', { valueAsNumber: true })}
              placeholder="0.00"
            />
            {errors.price && (
              <p className="text-sm text-destructive mt-1">{errors.price.message}</p>
            )}
          </div>

          <div>
            <Label htmlFor="weight">Peso (kg)</Label>
            <Input
              id="weight"
              type="number"
              step="0.01"
              {...register('weight', { valueAsNumber: true })}
              placeholder="0.00"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="dimensions">Dimensões</Label>
          <Input
            id="dimensions"
            {...register('dimensions')}
            placeholder="Ex: 10x20x30 cm"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="origin_city">Cidade de Origem</Label>
            <Input
              id="origin_city"
              {...register('origin_city')}
              placeholder="Ex: São Paulo"
            />
          </div>

          <div>
            <Label htmlFor="category">Categoria</Label>
            <Select 
              value={watch('category')} 
              onValueChange={(value) => setValue('category', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione uma categoria" />
              </SelectTrigger>
              <SelectContent className="bg-background border border-border shadow-lg z-50">
                {categories.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label htmlFor="stock_quantity">Quantidade em Estoque</Label>
          <Input
            id="stock_quantity"
            type="number"
            {...register('stock_quantity', { valueAsNumber: true })}
            placeholder="0"
          />
          {errors.stock_quantity && (
            <p className="text-sm text-destructive mt-1">{errors.stock_quantity.message}</p>
          )}
        </div>

        <div className="flex items-center space-x-2">
          <Switch
            id="is_active"
            checked={isActive}
            onCheckedChange={(checked) => setValue('is_active', checked)}
          />
          <Label htmlFor="is_active">Produto ativo</Label>
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? 'Salvando...' : initialData?.id ? 'Atualizar Produto' : 'Criar Produto'}
      </Button>
    </form>
  );
};