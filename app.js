// SETUP URL API DISINI
// GANTI DENGAN URL WEB APP GOOGLE APPS SCRIPT ANDA
const API_URL = "URL_WEB_APP_ANDA";

// STATE
let currentUser = null; // { role, gen, token }
let rawTreeData = [];
let zoomObj = null;
let svgGroup = null;
let previousTab = 'dashboard';
let sessionTimer = null;
let warningTimer = null;
let treeCacheDirty = true; // Flag: apakah tree perlu render ulang
const SESSION_TIMEOUT = 15 * 60 * 1000; // 15 menit
const WARNING_TIME = 2 * 60 * 1000; // 2 menit sebelum timeout

// HELPER: Convert Drive URL to Thumbnail (Bypass CORS mixed-content)
function getDisplayUrl(url) {
    if (!url) return "https://ui-avatars.com/api/?name=User&background=random";

    // Jika data berupa ID File Drive hasil perbaikan di atas (panjang karakter pendek & tidak ada 'http')
    if (url.length < 50 && !url.includes("http")) {
        return `https://drive.google.com/thumbnail?sz=w1000&id=${url}`;
    }

    // Antitesis untuk data lama yang telanjur menyimpan URL lengkap dengan parameter 'id='
    if (url.includes("id=")) {
        const id = url.split("id=")[1].split("&")[0];
        return `https://drive.google.com/thumbnail?sz=w1000&id=${id}`;
    }

    return url;
}

// SESSION TIMEOUT
function resetSessionTimer() {
    // Hapus timer yang berjalan
    if (sessionTimer) clearTimeout(sessionTimer);
    if (warningTimer) clearTimeout(warningTimer);

    // Timer untuk peringatan (muncul WARNING_TIME sebelum timeout)
    warningTimer = setTimeout(() => {
        Swal.fire({
            icon: 'warning',
            title: 'Sesi Akan Berakhir',
            text: `Anda tidak melakukan aktivitas selama ${SESSION_TIMEOUT/60000 - WARNING_TIME/60000} menit. Sesi akan berakhir dalam ${WARNING_TIME/60000} menit.`,
            confirmButtonText: 'Perpanjang Sesi',
            confirmButtonColor: '#166534',
            showCancelButton: true,
            cancelButtonText: 'Tidak',
            cancelButtonColor: '#6b7280',
            allowOutsideClick: false
        }).then((result) => {
            if (result.isConfirmed) {
                resetSessionTimer(); // Reset timer dari awal
            }
        });
    }, SESSION_TIMEOUT - WARNING_TIME);

    // Timer untuk logout (setelah SESSION_TIMEOUT)
    sessionTimer = setTimeout(() => {
        Swal.fire({
            icon: 'info',
            title: 'Sesi Berakhir',
            text: 'Anda tidak melakukan aktivitas selama ' + (SESSION_TIMEOUT/60000) + ' menit. Silakan login kembali.',
            timer: 3000,
            showConfirmButton: false,
            allowOutsideClick: false
        }).then(() => logout());
    }, SESSION_TIMEOUT);
}

// INIT & UTILS
document.addEventListener('DOMContentLoaded', () => {
    initGenDropdowns();
    checkSession();
    
    // Search Global Listener
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', debounce(handleSearch, 300));
    document.addEventListener('click', (e) => {
        if(!document.getElementById('searchDropdown').contains(e.target)) {
            document.getElementById('searchDropdown').classList.add('hide');
        }
    });

    // Session timeout - reset timer setiap ada aktivitas user
    ['click', 'keydown', 'mousemove', 'scroll', 'touchstart'].forEach(event => {
        document.addEventListener(event, () => {
            if (currentUser) resetSessionTimer();
        });
    });
});

function debounce(func, delay) {
    let timeout;
    return function(...args) { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), delay); };
}

function initGenDropdowns() {
    const genSel = document.getElementById('inpGen');
    for(let i=1; i<=10; i++) {
        genSel.innerHTML += `<option value="${i}">Generasi ${i}</option>`;
    }
    
    // Generate Legend Content
    const legends = [
        {g: 1, c: '#eab308', l: 'Gen 1 (Puhun)'},
        {g: 2, c: '#9ca3af', l: 'Gen 2'},
        {g: 3, c: '#f97316', l: 'Gen 3'},
        {g: 4, c: '#3b82f6', l: 'Gen 4'},
        {g: 5, c: '#a855f7', l: 'Gen 5'},
        {g: 'Almarhum', c: '#94a3b8', l: 'Garis Putus-putus'}
    ];
    const lgList = document.getElementById('legendList');
    legends.forEach(lg => {
        lgList.innerHTML += `<li class="flex items-center gap-2"><div style="background:${lg.c};" class="w-3 h-3 rounded-full"></div> ${lg.l}</li>`;
    });
}

// UI ACTIONS
function togglePassword() {
    const pwd = document.getElementById('loginPassword');
    const icon = document.getElementById('eyeIcon');
    if(pwd.type === 'password') { pwd.type = 'text'; icon.classList.replace('fa-eye', 'fa-eye-slash'); } 
    else { pwd.type = 'password'; icon.classList.replace('fa-eye-slash', 'fa-eye'); }
}

function toggleGenSelect() {
    const role = document.getElementById('loginRole').value;
    document.getElementById('genSelectDiv').style.display = role === 'admin' ? 'none' : 'block';
}

function toggleDeathDate() {
    const status = document.getElementById('inpStatus').value;
    document.getElementById('deathDateDiv').style.display = status === 'Almarhum' ? 'block' : 'none';
}

function showLoading(text="Memproses...") {
    document.getElementById('loadingText').innerText = text;
    document.getElementById('loadingOverlay').classList.remove('hide');
}
function hideLoading() { document.getElementById('loadingOverlay').classList.add('hide'); }

function switchTab(tabId) {
    document.querySelectorAll('main > section').forEach(sec => sec.classList.add('hide'));
    document.getElementById(`view-${tabId}`).classList.remove('hide');
    if(tabId === 'tree') renderTree();
}

function nextStep(step) {
    document.querySelectorAll('.step-content').forEach(s => s.classList.add('hide'));
    document.getElementById(`step${step}`).classList.remove('hide');
    document.getElementById('stepIndicator').innerText = `Langkah ${step}/3`;
}

function toggleLegend() {
    document.getElementById('legendPanel').classList.toggle('hide');
}

// AUTHENTICATION
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const role = document.getElementById('loginRole').value;
    const gen = document.getElementById('loginGen').value;
    const pwd = document.getElementById('loginPassword').value;

    showLoading("Memverifikasi...");
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'login', role, gen, pwd })
        }).then(r => r.json());

        if(res.success) {
            currentUser = { role, gen: role === 'admin' ? 'all' : parseInt(gen), token: res.token };
            localStorage.setItem('silsilah_session', JSON.stringify(currentUser));
            document.getElementById('loginOverlay').classList.add('hide');
            document.getElementById('mainApp').classList.remove('hide');
            resetSessionTimer();
            loadDashboard();
        } else {
            Swal.fire('Gagal', res.message, 'error');
        }
    } catch (err) {
        Swal.fire('Error', 'Gagal terhubung ke server.', 'error');
    }
    hideLoading();
});

function checkSession() {
    const session = localStorage.getItem('silsilah_session');
    if(session) {
        currentUser = JSON.parse(session);
        document.getElementById('loginOverlay').classList.add('hide');
        document.getElementById('mainApp').classList.remove('hide');
        loadDashboard();
    }
}

function logout() {
    if (sessionTimer) clearTimeout(sessionTimer);
    if (warningTimer) clearTimeout(warningTimer);
    localStorage.removeItem('silsilah_session');
    location.reload();
}

// FETCH DATA
async function loadDashboard() {
    showLoading("Memuat Dashboard...");
    try {
        const res = await fetch(`${API_URL}?action=stats`).then(r => r.json());
        if(res.success) {
            document.getElementById('statGen').innerText = res.data.totalGen;
            document.getElementById('statTotal').innerText = res.data.total;
            document.getElementById('statParent').innerText = res.data.parents;
            document.getElementById('statChild').innerText = res.data.children;
            rawTreeData = res.data.treeData; // cache for tree and search
            treeCacheDirty = true; // data baru, perlu render ulang tree
        }
    } catch (e) { console.error(e); }
    hideLoading();
    switchTab('dashboard');
}

// SEARCH
function handleSearch(e) {
    const val = e.target.value.toLowerCase();
    const drop = document.getElementById('searchDropdown');
    if(val.length < 2) { drop.classList.add('hide'); return; }

    const results = rawTreeData.filter(d => d.Nama.toLowerCase().includes(val)).slice(0, 5);
    if(results.length === 0) { drop.classList.add('hide'); return; }

    drop.innerHTML = results.map(r => `
        <div class="p-3 border-b hover:bg-gray-50 cursor-pointer flex items-center gap-3" onclick="focusToNode('${r.ID}')">
            <img src="${getDisplayUrl(r['Foto URL'])}" class="w-10 h-10 rounded-full object-cover">
            <div>
                <div class="font-semibold text-sm">${r.Nama}</div>
                <div class="text-xs text-gray-500">Generasi ${r.Generasi}</div>
            </div>
        </div>
    `).join('');
    drop.classList.remove('hide');
}

function focusToNode(id) {
    document.getElementById('searchDropdown').classList.add('hide');
    document.getElementById('searchInput').value = "";
    switchTab('tree');
    
    // Wait for render
    setTimeout(() => {
        if(!window.rootData) return;
        
        // Find node
        const targetNode = window.rootData.descendants().find(d => d.data.ID === id);
        if(!targetNode) return;

        // Expand ancestors
        let parent = targetNode.parent;
        while(parent) {
            if(parent._children) {
                parent.children = parent._children;
                parent._children = null;
            }
            parent = parent.parent;
        }
        updateD3(window.rootData);

        // Zoom to node
        const transform = d3.zoomIdentity
            .translate(document.getElementById('treeContainer').clientWidth / 2 - targetNode.y, 
                       document.getElementById('treeContainer').clientHeight / 2 - targetNode.x)
            .scale(1);
        
        d3.select('#treeContainer svg').transition().duration(750)
            .call(zoomObj.transform, transform);

        // Highlight
        d3.selectAll('.node-card rect').classed('highlight-border', false);
        d3.select(`#node-${id} rect`).classed('highlight-border', true);
        
        // Show modal after zoom
        setTimeout(() => showDetailModal(targetNode.data), 800);

    }, 500);
}

// D3.JS TREE LOGIC
const getGenStyle = (gen) => {
    const styles = {
        1: {bg: '#fef08a', border: '#eab308', emoji: '👑'},
        2: {bg: '#f3f4f6', border: '#9ca3af', emoji: '🌟'},
        3: {bg: '#fed7aa', border: '#f97316', emoji: '🛡️'},
        4: {bg: '#dbeafe', border: '#3b82f6', emoji: '⚔️'},
        5: {bg: '#f3e8ff', border: '#a855f7', emoji: '📜'}
    };
    return styles[gen] || {bg: '#dcfce7', border: '#22c55e', emoji: '🌿'};
};

function renderTree() {
    if(!rawTreeData || rawTreeData.length === 0) return;
    const container = document.getElementById('treeContainer');
    
    // Cache: jika tree sudah ada dan data belum berubah, skip render ulang
    if(!treeCacheDirty && container.querySelector('svg')) {
        return;
    }
    
    container.innerHTML = "";
    treeCacheDirty = false; // tandai sudah di-render
    
    const width = container.clientWidth;
    const height = container.clientHeight;
    const cardW = 260; const cardH = 100;

    const svg = d3.select("#treeContainer").append("svg")
        .attr("width", "100%")
        .attr("height", "100%");

    svgGroup = svg.append("g");
    zoomObj = d3.zoom().scaleExtent([0.1, 3]).on("zoom", (e) => svgGroup.attr("transform", e.transform));
    svg.call(zoomObj);

    // Center initial
    svg.call(zoomObj.transform, d3.zoomIdentity.translate(50, height/2 - 100).scale(0.8));

    // Stratify
    let root;
    try {
        root = d3.stratify().id(d => d.ID).parentId(d => d["Parent ID"] || "")(rawTreeData);
    } catch(e) {
        console.error("Hierarchy error", e);
        return;
    }
    
    root.x0 = height / 2; root.y0 = 0;
    
    // Collapse all except Gen 1 & 2
    root.descendants().forEach(d => {
        if (d.depth > 1) {
            d._children = d.children;
            d.children = null;
        }
    });

    window.rootData = root;
    window.treeMap = d3.tree().nodeSize([cardH + 40, cardW + 80]); // Vertical gap, Horizontal gap

    updateD3(root);
}

function updateD3(source) {
    let i = 0;
    const treeData = window.treeMap(window.rootData);
    const nodes = treeData.descendants();
    const links = treeData.descendants().slice(1);
    const cardW = 260; const cardH = 100;

    nodes.forEach(d => { d.y = d.depth * (cardW + 100); });

    // NODES
    const node = svgGroup.selectAll('g.node')
        .data(nodes, d => d.id || (d.id = ++i));

    const nodeEnter = node.enter().append('g')
        .attr('class', 'node')
        .attr("transform", d => `translate(${source.y0},${source.x0})`)
        .attr('id', d => `node-${d.data.ID}`);

    // Card Body (Click to detail)
    const cardBody = nodeEnter.append('g').attr('class', 'node-card')
        .on('click', (event, d) => showDetailModal(d.data));

    cardBody.append('rect')
        .attr('width', cardW).attr('height', cardH)
        .attr('y', -cardH/2)
        .attr('rx', 12).attr('ry', 12)
        .style('fill', d => getGenStyle(d.data.Generasi).bg)
        .style('stroke', d => getGenStyle(d.data.Generasi).border)
        .style('stroke-width', 2)
        .style('opacity', d => d.data.Status === 'Almarhum' ? 0.7 : 1);

    // Photo
    cardBody.append('image')
        .attr('href', d => getDisplayUrl(d.data['Foto URL']))
        .attr('x', 10).attr('y', -cardH/2 + 10)
        .attr('width', 60).attr('height', 60)
        .attr('preserveAspectRatio', 'xMidYMid slice')
        .attr('clip-path', 'circle(50% at 50% 50%)'); // basic clip simulation, better done via defs

    // Text
    cardBody.append('text')
        .attr('x', 80).attr('y', -cardH/2 + 30)
        .style('font-weight', 'bold').style('font-size', '16px').style('fill', '#1f2937')
        .text(d => d.data.Nama.length > 17 ? d.data.Nama.substring(0,15)+'...' : d.data.Nama);

    cardBody.append('text')
        .attr('x', 80).attr('y', -cardH/2 + 50)
        .style('font-size', '12px').style('fill', '#4b5563')
        .text(d => `${getGenStyle(d.data.Generasi).emoji} Gen ${d.data.Generasi} | ` + (d.data.Status === 'Almarhum' ? '🪦' : '🟢'));

    cardBody.append('text')
        .attr('x', 80).attr('y', -cardH/2 + 70)
        .style('font-size', '12px').style('fill', '#dc2626')
        .text(d => d.data.Pasangan ? `❤️ ${d.data.Pasangan}` : '');

    // Expand/Collapse Button
    const btnGroup = nodeEnter.append('g')
        .attr('transform', `translate(${cardW}, 0)`)
        .style('cursor', 'pointer')
        .on('click', (event, d) => {
            if (d.children) { d._children = d.children; d.children = null; } 
            else { d.children = d._children; d._children = null; }
            updateD3(d);
        });

    btnGroup.append('circle')
        .attr('r', 12).style('fill', '#fff').style('stroke', '#166534')
        .style('display', d => (d._children || d.children) ? 'block' : 'none');

    btnGroup.append('text')
        .attr('dy', 5).attr('dx', -4)
        .style('font-weight', 'bold').style('fill', '#166534')
        .text(d => d._children ? '+' : '-')
        .style('display', d => (d._children || d.children) ? 'block' : 'none');

    // UPDATE
    const nodeUpdate = nodeEnter.merge(node);
    nodeUpdate.transition().duration(500)
        .attr("transform", d => `translate(${d.y},${d.x})`);

    // EXIT
    const nodeExit = node.exit().transition().duration(500)
        .attr("transform", d => `translate(${source.y},${source.x})`)
        .remove();

    // LINKS
    const link = svgGroup.selectAll('path.link').data(links, d => d.id);

    const linkEnter = link.enter().insert('path', "g")
        .attr("class", "link")
        .attr('d', d => {
            const o = {x: source.x0, y: source.y0};
            return diagonal(o, o);
        });

    const linkUpdate = linkEnter.merge(link);
    linkUpdate.transition().duration(500)
        .attr('d', d => diagonal(d, d.parent))
        .style("stroke-dasharray", d => d.data.Status === 'Almarhum' ? "5,5" : "none");

    link.exit().transition().duration(500)
        .attr('d', d => {
            const o = {x: source.x, y: source.y};
            return diagonal(o, o);
        }).remove();

    nodes.forEach(d => { d.x0 = d.x; d.y0 = d.y; });
}

function diagonal(s, d) {
    return `M ${s.y} ${s.x} C ${(s.y + d.y) / 2} ${s.x}, ${(s.y + d.y) / 2} ${d.x}, ${d.y + 260} ${d.x}`;
}

function zoomIn() { d3.select('#treeContainer svg').transition().call(zoomObj.scaleBy, 1.2); }
function zoomOut() { d3.select('#treeContainer svg').transition().call(zoomObj.scaleBy, 0.8); }
function resetZoom() { d3.select('#treeContainer svg').transition().call(zoomObj.transform, d3.zoomIdentity.translate(50, document.getElementById('treeContainer').clientHeight/2 - 100).scale(0.8)); }

// MODAL DETAIL
function showDetailModal(data) {
    const allowEdit = currentUser.role === 'admin' || currentUser.gen == data.Generasi;
    
    let html = `
        <div class="text-left space-y-3">
            <div class="flex justify-center mb-4">
                <img src="${getDisplayUrl(data['Foto URL'])}" class="w-32 h-32 rounded-full object-cover border-4 border-brand">
            </div>
            <table class="w-full text-sm">
                <tr><td class="text-gray-500 py-1 w-1/3">Nama</td><td class="font-bold">: ${data.Nama}</td></tr>
                <tr><td class="text-gray-500 py-1">Generasi</td><td>: ${data.Generasi}</td></tr>
                <tr><td class="text-gray-500 py-1">Status</td><td>: <span class="${data.Status==='Hidup'?'text-green-600':'text-gray-600'} font-bold">${data.Status}</span></td></tr>
                ${data.Status === 'Almarhum' && data['Tgl Meninggal'] ? `<tr><td class="text-gray-500 py-1">Wafat</td><td>: ${data['Tgl Meninggal']}</td></tr>` : ''}
                <tr><td class="text-gray-500 py-1">Pasangan</td><td>: ${data.Pasangan || '-'}</td></tr>
                <tr><td class="text-gray-500 py-1">Alamat</td><td>: ${data.Alamat || '-'}</td></tr>
                <tr><td class="text-gray-500 py-1">No HP</td><td>: ${data['No HP'] || '-'}</td></tr>
            </table>
            
            ${data['No HP'] ? `
                <a href="https://wa.me/${data['No HP']}" target="_blank" class="mt-4 block w-full text-center bg-green-500 hover:bg-green-600 text-white py-2 rounded-lg font-semibold">
                    <i class="fab fa-whatsapp mr-1"></i> Hubungi WhatsApp
                </a>
            ` : ''}
            
            ${allowEdit ? `
                <div class="flex gap-2 mt-4 pt-4 border-t">
                    <button onclick="editNode('${data.ID}')" class="flex-1 bg-amber-500 text-white py-2 rounded shadow"><i class="fas fa-edit"></i> Edit</button>
                    <button onclick="deleteNode('${data.ID}')" class="flex-1 bg-red-500 text-white py-2 rounded shadow"><i class="fas fa-trash"></i> Hapus</button>
                </div>
            ` : '<div class="mt-4 pt-2 border-t text-xs text-center text-gray-400">Aksi edit/hapus hanya untuk Admin atau Generasi se-level.</div>'}
        </div>
    `;

    Swal.fire({
        title: false, html: html, showConfirmButton: false, showCloseButton: true,
        customClass: { popup: 'rounded-2xl' }
    });
}

// FORM LOGIC
function openForm(isEdit = false) {
    // Simpan tab aktif sebelumnya
    const visibleSection = document.querySelector('main > section:not(.hide)');
    if (visibleSection) {
        const tabId = visibleSection.id.replace('view-', '');
        previousTab = tabId;
    }
    
    document.getElementById('formTitle').innerText = isEdit ? "Edit Anggota" : "Tambah Anggota";
    if(!isEdit) document.getElementById('memberForm').reset();
    document.getElementById('fotoPreview').classList.add('hide');
    document.getElementById('fotoIcon').classList.remove('hide');
    document.getElementById('childrenContainer').innerHTML = "";
    switchTab('form');
    nextStep(1);
}

function closeForm() {
    // Reset step indicator ke langkah 1
    document.querySelectorAll('.step-content').forEach(s => s.classList.add('hide'));
    document.getElementById('step1').classList.remove('hide');
    document.getElementById('stepIndicator').innerText = 'Langkah 1/3';
    
    // Kembali ke tab sebelumnya
    switchTab(previousTab);
}

async function loadParents() {
    const gen = parseInt(document.getElementById('inpGen').value);
    const pSel = document.getElementById('inpParent');
    pSel.innerHTML = '<option value="">Memuat...</option>';
    pSel.disabled = true;

    if (gen <= 1) {
        pSel.innerHTML = '<option value="">Tidak ada (Root)</option>';
        return;
    }

    try {
        const res = await fetch(`${API_URL}?action=parents&gen=${gen-1}`).then(r => r.json());
        if(res.success && res.data.length > 0) {
            pSel.innerHTML = '<option value="">Pilih Orang Tua</option>' + res.data.map(p => `<option value="${p.ID}">${p.Nama}</option>`).join('');
            pSel.disabled = false;
        } else {
            pSel.innerHTML = '<option value="">Tidak ada data di generasi atas</option>';
        }
    } catch(e) {
        pSel.innerHTML = '<option value="">Gagal memuat</option>';
    }
}

function previewImage(event) {
    const file = event.target.files[0];
    if(file) {
        if(file.size > 2 * 1024 * 1024) { Swal.fire('Error', 'Maksimal ukuran foto 2MB', 'error'); return; }
        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('fotoPreview').src = e.target.result;
            document.getElementById('fotoPreview').classList.remove('hide');
            document.getElementById('fotoIcon').classList.add('hide');
            document.getElementById('fotoBase64').value = e.target.result.split(',')[1]; 
        };
        reader.readAsDataURL(file);
    }
}

function addChildInput() {
    const div = document.createElement('div');
    div.className = "flex gap-2 items-center mb-2";
    div.innerHTML = `
        <input type="text" placeholder="Nama Lengkap Anak" class="child-inp flex-1 p-2 border rounded focus:ring-brand" required>
        <button type="button" onclick="this.parentElement.remove()" class="text-red-500 p-2"><i class="fas fa-times"></i></button>
    `;
    document.getElementById('childrenContainer').appendChild(div);
}

// SUBMIT FORM
document.getElementById('memberForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Collect Children
    const childrenInputs = document.querySelectorAll('.child-inp');
    const anakArray = Array.from(childrenInputs).map(inp => inp.value).filter(val => val.trim() !== "");

    const payload = {
        action: 'save',
        token: currentUser.token,
        data: {
            ID: document.getElementById('inpHiddenID').value,
            Nama: document.getElementById('inpNama').value,
            Gender: document.getElementById('inpGender').value,
            Generasi: document.getElementById('inpGen').value,
            ParentID: document.getElementById('inpParent').value,
            Status: document.getElementById('inpStatus').value,
            TglMeninggal: document.getElementById('inpTglMeninggal').value,
            Pasangan: document.getElementById('inpPasangan').value,
            NoHP: document.getElementById('inpHP').value,
            Alamat: document.getElementById('inpAlamat').value,
            FotoBase64: document.getElementById('fotoBase64').value,
            Anak: anakArray
        }
    };

    showLoading("Menyimpan Data...");
    try {
        const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload) }).then(r => r.json());
        hideLoading();
        if(res.success) {
            Swal.fire('Berhasil', 'Data tersimpan!', 'success');
            loadDashboard(); // Refresh all
        } else {
            Swal.fire('Gagal', res.message, 'error');
        }
    } catch(err) {
        hideLoading();
        Swal.fire('Error', 'Gagal menghubungi server.', 'error');
    }
});

// EDIT & DELETE
function editNode(id) {
    Swal.close();
    const node = rawTreeData.find(d => d.ID === id);
    if(!node) return;
    
    document.getElementById('inpHiddenID').value = node.ID;
    document.getElementById('inpNama').value = node.Nama;
    document.getElementById('inpGender').value = node.Gender;
    
    // Set Gen and load parents async, then set parent
    document.getElementById('inpGen').value = node.Generasi;
    loadParents().then(() => {
        document.getElementById('inpParent').value = node['Parent ID'];
    });

    document.getElementById('inpStatus').value = node.Status;
    toggleDeathDate();
    document.getElementById('inpTglMeninggal').value = node['Tgl Meninggal'] || "";
    document.getElementById('inpPasangan').value = node.Pasangan || "";
    document.getElementById('inpHP').value = node['No HP'] || "";
    document.getElementById('inpAlamat').value = node.Alamat || "";
    
    // Photo Preview
    if(node['Foto URL']) {
        document.getElementById('fotoPreview').src = getDisplayUrl(node['Foto URL']);
        document.getElementById('fotoPreview').classList.remove('hide');
        document.getElementById('fotoIcon').classList.add('hide');
    }

    openForm(true);
}

async function deleteNode(id) {
    Swal.close();
    const confirm = await Swal.fire({
        title: 'Hapus Data?', text: "Data tidak dapat dikembalikan!", icon: 'warning',
        showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'Ya, Hapus!'
    });
    
    if(confirm.isConfirmed) {
        showLoading("Menghapus...");
        try {
            const res = await fetch(API_URL, { 
                method: 'POST', 
                body: JSON.stringify({ action: 'deleteMember', token: currentUser.token, id: id }) 
            }).then(r => r.json());
            hideLoading();
            if(res.success) {
                Swal.fire('Terhapus!', '', 'success');
                loadDashboard();
            } else { Swal.fire('Gagal', res.message, 'error'); }
        } catch(e) { hideLoading(); Swal.fire('Error', '', 'error'); }
    }
}