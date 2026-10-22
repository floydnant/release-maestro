import { BandcampFan, BandcampPurchase } from './feed-source.schema'

export const mergeBandcampFans = (...groups: BandcampFan[][]): BandcampFan[] => {
    const fans = new Map<string, BandcampFan>()
    for (const fan of groups.flat()) {
        const previous = fans.get(fan.profileUrl)
        fans.set(fan.profileUrl, { ...fan, imageUrl: fan.imageUrl ?? previous?.imageUrl ?? null })
    }
    return [...fans.values()]
}

export const mergeBandcampPurchases = (
    previous: BandcampPurchase[],
    incoming: BandcampPurchase[],
): BandcampPurchase[] => {
    const purchases = new Map<string, BandcampPurchase>()
    for (const purchase of [...previous, ...incoming]) {
        purchases.set(purchase.tralbumUrl, {
            tralbumUrl: purchase.tralbumUrl,
            fans: mergeBandcampFans(purchases.get(purchase.tralbumUrl)?.fans ?? [], purchase.fans),
        })
    }
    return [...purchases.values()]
}
