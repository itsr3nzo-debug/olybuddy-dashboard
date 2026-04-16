interface ProviderIconProps {
  provider: { id: string; name: string; iconUrl?: string; iconColor: string }
  size?: number
}

export default function ProviderIcon({ provider, size = 32 }: ProviderIconProps) {
  if (provider.iconUrl) {
    return (
      <img
        src={provider.iconUrl}
        alt={provider.name}
        width={size}
        height={size}
        className="rounded"
        loading="lazy"
      />
    )
  }

  const letter = provider.name.charAt(0).toUpperCase()
  return (
    <div
      className={`flex items-center justify-center rounded-lg font-bold ${provider.iconColor}`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {letter}
    </div>
  )
}
