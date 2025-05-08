
this.singular4 = (dn,stripped) => {
	let n = dn.name || dn; if (stripped) n = n.match(last)[0]
	return dn['@singular'] || (
		/species|news$/i.test(n) ? n  :
		/ess$/.test(n) ? n :      							// Address
		/ees$/.test(n) ? n.slice(0, -1) : 			// Employees --> Employee
		/[sz]es$/.test(n) ?  n.slice(0, -2) :
		/[^aeiou]ies$/.test(n) ? n.slice(0, -3) + 'y' :     // Deliveries --> Delivery
		/s$/.test(n) ?  n.slice(0, -1) :
		n
	)
}

this.plural4 = (dn,stripped) => {
	let n = dn.name || dn; if (stripped) n = n.match(last)[0]
	return dn['@plural'] || (
		/analysis|status|species|sheep|news$/i.test(n) ? n  :
		/[^aeiou]y$/.test(n) ? n.slice(0,-1) + 'ies'  :
		/(s|x|z|ch|sh)$/.test(n) ? n + 'es' :
		n + 's'
	)
}

const last = /\w+$/
