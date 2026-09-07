import React from 'react';
import { Scissors, Building2, Users, Stethoscope } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const services = [
  { icon: Scissors, title: 'Petshop', path: '/petshop', gradient: 'from-pink-500 to-rose-400', bg: 'bg-pink-50' },
  { icon: Users, title: 'Rede Pet', path: '/rede-pet', gradient: 'from-blue-500 to-cyan-400', bg: 'bg-blue-50' },
  { icon: Building2, title: 'Hotel', path: '/hotelaria', gradient: 'from-amber-500 to-yellow-400', bg: 'bg-amber-50' },
  { icon: Stethoscope, title: 'Veterinário', path: '/veterinario', gradient: 'from-emerald-500 to-green-400', bg: 'bg-emerald-50' },
];

export const Services = () => {
  const navigate = useNavigate();

  return (
    <div className="px-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-foreground">Serviços</h2>
      </div>
      
      <div className="grid grid-cols-4 gap-3">
        {services.map((service, index) => (
          <button
            key={index}
            onClick={() => navigate(service.path)}
            className={`${service.bg} p-3 rounded-2xl flex flex-col items-center justify-center gap-2 hover:scale-105 active:scale-95 transition-all duration-200`}
          >
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${service.gradient} flex items-center justify-center shadow-sm`}>
              <service.icon className="w-5 h-5 text-white" />
            </div>
            <span className="text-[11px] text-foreground font-medium leading-tight text-center">{service.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
