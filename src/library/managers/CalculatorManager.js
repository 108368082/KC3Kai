/**
 * CalculatorManager.js exported to window.KC3Calc.
 *
 * A collection or facade of calculation methods implemented by KC3改,
 * to simulate KC game mechanism, client behaviors or just some convenience methods.
 *
 * Lite methods collected here suggested to be general purpose, multi relationships
 * and done within one or few functions.
 *
 * Basic calculation logics related to specific class are located in their corresponding Object definition,
 * such as Fleet, Ships, Gear, LandBase.
 *
 * Complex logic functions will be broken into individual modules or objects:
 * @see BattlePrediction - analyses battle API data and and simulates the battle results in advance;
 * @see AntiAir - estimates Anti-Air power and AACI types based on Ship's equipment, Fleet compos, etc;
 * @see WhoCallsTheFleetDB - estimates more stats of Ship or Gear based on a well updated static database;
 * @see AkashiRepair - simulates Akashi Anchorage Repair timer, estimates amount of HP recovering;
 */
(function(){
    "use strict";

    /**
     * Get fighter power text from 1 or more fleet(s), especially served for Combined Fleet.
     *
     * @param {Object} viewFleet - Fleet object currently being viewed, default 1st fleet.
     * @param {Object} escortFleet - Fleet object of escort for Combined Fleet, default 2nd fleet.
     * @param {boolean} isCombined - if current view is really Combined Fleet view, default false.
     * @return {string} fighter power text, formation according config: `air_formula`.
     * @see Fleet.fighterPowerText similar function only served for Fleet object.
     * @see Fleet.fighterVeteran
     * @see Fleet.fighterBounds
     * @see Fleet.fighterPower
     */
    const getFleetsFighterPowerText = (
            viewFleet = PlayerManager.fleets[0],
            escortFleet = PlayerManager.fleets[1],
            isCombined = false) => {
        var mainFleet = viewFleet;
        if(isCombined) { // force to 1st fleet if combined
            mainFleet = viewFleet = PlayerManager.fleets[0];
        }
        switch(ConfigManager.air_formula) {
            case 2:
                return "\u2248" + (
                    isCombined && ConfigManager.air_combined ?
                    mainFleet.fighterVeteran() + escortFleet.fighterVeteran() :
                    viewFleet.fighterVeteran());
            case 3:
                const mainBounds = mainFleet.fighterBounds();
                const escortBounds = escortFleet.fighterBounds();
                return  (isCombined && ConfigManager.air_combined ?
                        mainBounds[0] + escortBounds[0] : mainBounds[0])
                        + "~" +
                        (isCombined && ConfigManager.air_combined ?
                        mainBounds[1] + escortBounds[1] : mainBounds[1]);
            default:
                return isCombined && ConfigManager.air_combined ?
                    mainFleet.fighterPower() + escortFleet.fighterPower() :
                    viewFleet.fighterPower();
        }
    };

    /**
     * @return total resupply cost of all land bases.
     * @see PlayerManager.bases
     * @see LandBase.calcResupplyCost
     */
    const getLandBasesResupplyCost = () => {
        const total = {fuel: 0, ammo: 0, steel: 0, bauxite: 0};
        $.each(PlayerManager.bases, (i, base) => {
            const cost = base.calcResupplyCost();
            Object.keys(total).map(k => { total[k] += cost[k]; });
        });
        return total;
    };

    /**
     * @return total cost on sortie of all land bases set to sortie.
     * @see PlayerManager.bases
     * @see LandBase.calcSortieCost
     */
    const getLandBasesSortieCost = () => {
        const total = {fuel: 0, ammo: 0, steel: 0, bauxite: 0};
        $.each(PlayerManager.bases, (i, base) => {
            if(base.action === 1) {
                var cost = base.calcSortieCost();
                Object.keys(total).map(k => { total[k] += cost[k]; });
            }
        });
        return total;
    };

    /**
     * @return {number} the worst cond value [1, 3] of all land bases which are set to sortie.
     * @see PlayerManager.bases
     * @see LandBase.worstCond
     */
    const getLandBasesWorstCond = () => {
        var worst = 1;
        $.each(PlayerManager.bases, (i, base) => {
            if(base.action === 1) {
                worst = Math.max(worst, base.worstCond());
            }
        });
        return worst;
    };

    /**
     * @return {boolean} is all available land bases get resupplied.
     * @see PlayerManager.bases
     * @see LandBase.isPlanesSupplied
     */
    const isLandBasesSupplied = () => {
        return PlayerManager.bases.every(base => base.isPlanesSupplied());
    };

    /**
     * Get battle opponent's fighter power only based on master data.
     *
     * @param {Array}  enemyFleetShips - master ID array of opponent fleet ships.
     * @param {Array[]} enemyShipSlots - master ID array of equip slots, optional.
     *                                   length should be the same with enemyFleetShips.
     * @param {Array[]} enemySlotSizes - capacities of equip slots, optional, same length either.
     * @return {Array} a tuple contains [
     *           computed fighter power (without improvement and proficiency bonus),
     *           sum of known slot capacity,
     *           sum of slot capacity without air power,
     *           sum of slot capacity with recon planes equipped,
     *           exception map indicates which ship or gear missing required data:
     *             {shipId: null || {gearId: null || aaStat || 'recon'}}
     *         ]
     * @see Fleet, Ship, Gear classes to compute fighter power of player fleet.
     */
    const enemyFighterPower = (enemyFleetShips, enemyShipSlots, enemySlotSizes) => {
        var totalPower = false;
        var totalCapacity = 0;
        var noAirPowerCapacity = 0;
        var reconCapacity = 0;
        const exceptions = {};
        // no ship IDs
        if(!enemyFleetShips) {
            exceptions.ship = null;
            return [totalPower, totalCapacity, exceptions];
        }
        $.each(enemyFleetShips, (shipIdx, shipId) => {
            // ignore -1 placeholder
            if(!shipId || shipId < 0) {
                return;
            }
            const shipMst = KC3Master.isAbyssalShip(shipId) ?
                KC3Master.abyssalShip(shipId, true) : KC3Master.ship(shipId);
            // no ship master data
            if(!shipMst) {
                exceptions[shipId] = null;
                return;
            }
            let shipSlots = (enemyShipSlots || [])[shipIdx] || shipMst.kc3_slots;
            // no slot gear IDs
            if(!Array.isArray(shipSlots)) {
                exceptions[shipId] = {};
                return;
            }
            // mainly remove -1 placeholders
            shipSlots = shipSlots.filter(id => id > 0);
            for(let slotIdx = 0; slotIdx < shipSlots.length; slotIdx++) {
                const gearId = shipSlots[slotIdx];
                const gearMst = KC3Master.slotitem(gearId);
                // no gear master data
                if(!gearMst) {
                    exceptions[shipId] = exceptions[shipId] || {};
                    exceptions[shipId][gearId] = null;
                    continue;
                }
                if(KC3GearManager.antiAirFighterType2Ids.includes(gearMst.api_type[2])) {
                    const aaStat = gearMst.api_tyku || 0;
                    const capacity = ((enemySlotSizes || [])[shipIdx] || shipMst.api_maxeq || [])[slotIdx];
                    if(capacity !== undefined) {
                        if(aaStat > 0) {
                            totalCapacity += capacity;
                            totalPower += Math.floor(Math.sqrt(capacity) * aaStat);
                        } else {
                            noAirPowerCapacity += capacity;
                        }
                    } else {
                        // no slot maxeq (capacity)
                        exceptions[shipId] = exceptions[shipId] || {};
                        exceptions[shipId][gearId] = aaStat;
                    }
                } else if(gearMst.api_type[1] === 7) {
                    // sum recon planes not participate normal air battle but LBAA battle,
                    // seaplane fighters/bombers will not be dropped here
                    const capacity = ((enemySlotSizes || [])[shipIdx] || shipMst.api_maxeq || [])[slotIdx];
                    if(capacity !== undefined) {
                        reconCapacity += capacity;
                    } else {
                        exceptions[shipId] = exceptions[shipId] || {};
                        exceptions[shipId][gearId] = "recon";
                    }
                }
            }
        });
        return [totalPower, totalCapacity, noAirPowerCapacity, reconCapacity, exceptions];
    };

    const publicApi = {
    };

    // Export public API
    window.KC3Calc = Object.assign(publicApi, {
        getFleetsFighterPowerText,
        
        getLandBasesResupplyCost,
        getLandBasesSortieCost,
        getLandBasesWorstCond,
        isLandBasesSupplied,
        
        enemyFighterPower
    });

})();
