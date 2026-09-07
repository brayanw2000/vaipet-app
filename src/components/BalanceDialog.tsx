import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Wallet, CreditCard, Smartphone, QrCode } from 'lucide-react';
import { toast } from 'sonner';

interface BalanceDialogProps {
  balance: number;
  onAddBalance?: (amount: number, method: string) => void;
}

export const BalanceDialog = ({ balance, onAddBalance }: BalanceDialogProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);

  const paymentMethods = [
    { id: 'pix', name: 'PIX', icon: QrCode, color: 'from-teal-400 to-green-500' },
    { id: 'credit', name: 'Crédito', icon: CreditCard, color: 'from-purple-400 to-indigo-500' },
    { id: 'debit', name: 'Débito', icon: Smartphone, color: 'from-orange-400 to-amber-500' },
  ];

  const quickAmounts = [10, 20, 50, 100];

  const handleAddBalance = () => {
    const value = parseFloat(amount.replace(',', '.'));
    if (isNaN(value) || value <= 0) {
      toast.error('Digite um valor válido');
      return;
    }
    if (!selectedMethod) {
      toast.error('Selecione um método de pagamento');
      return;
    }
    
    onAddBalance?.(value, selectedMethod);
    toast.success(`Solicitação de R$ ${value.toFixed(2).replace('.', ',')} via ${paymentMethods.find(m => m.id === selectedMethod)?.name} enviada!`);
    setAmount('');
    setSelectedMethod(null);
    setIsOpen(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <button className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 transition-colors rounded-full px-3 py-1.5">
          <Wallet className="w-4 h-4" />
          <span className="text-sm font-semibold">
            R$ {balance.toFixed(2).replace('.', ',')}
          </span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-sm mx-auto">
        <DialogHeader>
          <DialogTitle className="text-center text-xl">Adicionar Saldo</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6 pt-4">
          {/* Saldo Atual */}
          <div className="text-center p-4 bg-gradient-to-br from-purple-100 to-orange-100 rounded-2xl">
            <p className="text-sm text-gray-600 mb-1">Saldo atual</p>
            <p className="text-3xl font-bold text-gray-800">
              R$ {balance.toFixed(2).replace('.', ',')}
            </p>
          </div>

          {/* Valor */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Quanto deseja adicionar?
            </label>
            <Input
              type="text"
              placeholder="R$ 0,00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="text-lg text-center font-semibold"
            />
            <div className="flex gap-2 mt-3">
              {quickAmounts.map((value) => (
                <button
                  key={value}
                  onClick={() => setAmount(value.toString())}
                  className="flex-1 py-2 text-sm font-medium bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  R$ {value}
                </button>
              ))}
            </div>
          </div>

          {/* Métodos de Pagamento */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-3 block">
              Método de pagamento
            </label>
            <div className="grid grid-cols-3 gap-3">
              {paymentMethods.map((method) => {
                const Icon = method.icon;
                const isSelected = selectedMethod === method.id;
                return (
                  <button
                    key={method.id}
                    onClick={() => setSelectedMethod(method.id)}
                    className={`flex flex-col items-center gap-2 p-4 rounded-xl transition-all ${
                      isSelected
                        ? `bg-gradient-to-br ${method.color} text-white scale-105 shadow-lg`
                        : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                    }`}
                  >
                    <Icon className="w-6 h-6" />
                    <span className="text-xs font-medium">{method.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Botão Confirmar */}
          <Button
            onClick={handleAddBalance}
            className="w-full bg-gradient-to-r from-purple-500 to-orange-500 hover:from-purple-600 hover:to-orange-600 text-white py-6 rounded-xl text-lg font-semibold"
          >
            Adicionar Saldo
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
