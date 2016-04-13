// ==UserScript==
// @name         Reddit Adhanced
// @namespace    http://julianhartline.com/
// @version      0.91
// @description  Enhance your advertising experience on Reddit
// @author       Julian Hartline (julianh2o)
// @match        https://www.reddit.com/promoted/
// @match        https://pay.reddit.com/promoted/pay/*
// @grant        none
// @updateURL    https://cdn.rawgit.com/julianh2o/RedditAdhanced/master/redditadhanced.user.js
// @grant GM_xmlhttpRequest 
// ==/UserScript==
/* jshint -W097 */
'use strict';

var storageKey = "RedditAdhancedStorage";
var storage = JSON.parse(localStorage.getItem(storageKey) || '{}');
if (!storage.archived) storage.archived = [];

var date = new Date();
if (!storage.startDate) storage.startDate = [date.getMonth()+1,date.getDate(),date.getFullYear()].join('/');
if (!storage.endDate) storage.endDate = [date.getMonth()+1,date.getDate(),date.getFullYear()].join('/');
if (!storage.budget) storage.budget = 5;
if (!storage.cpm) storage.cpm = 1.5;

function saveStorage() {
    localStorage.setItem(storageKey,JSON.stringify(storage));
}

function parseTable($el) {
    var headerValues = [];
    $el.find("thead tr th").each(function() {
        headerValues.push($(this).text());
    });

    var tableData = [];
    $el.find("tbody tr").each(function() {
        if ($(this).is(".total")) return;

        var columnIndex = 0;
        var rowData = {};
        $(this).find("td").each(function() {
            $(this).find(".help").remove();
            rowData[headerValues[columnIndex]] = $(this).text();
            columnIndex++;
        });
        tableData.push(rowData);
    });

    return tableData;
}

var hasRequestedPaymentInfo = false;
var accountSelect = null;
var customer_id = null;

var Promoted = function() { this.init.apply(this,arguments); };
$.extend(Promoted.prototype,{
    init:function($el) {
        this.$el = $el;

        var full=$el.data("fullname");
        this.id = full.substring(full.indexOf("_")+1);

        if ($.inArray(this.id,storage.archived) != -1) {
            //We're archived, hide me
            this.$el.hide();
            this.hidden = true;
            return;
        }

        this.$campaignAddendum = $("<div class='campaignAddendum' />").appendTo(this.$el);
        this.$campaignInfo = $("<div class='campaignInfo' />").appendTo(this.$campaignAddendum);
        this.$campaignField = $("<div class='campaignField' />").appendTo(this.$campaignAddendum);

        this.createCampaignForm();
        this.fetchCampaignInfo();
        this.fetchTrafficInfo();
        this.addArchiveButton();
    },
    createCampaignForm:function() {
        var $addBox = $("<div class='addBox' />");
        $addBox.append($("<input class='subreddit_field' name='sr' placeholder='Subreddit'/>"));
        $addBox.append($("<input class='startdate' name='startdate' placeholder='Start'/>").val(storage.startDate));
        $addBox.append($("<input class='enddate' name='enddate' placeholder='End'/>").val(storage.endDate));
        $addBox.append($("<input class='budget' name='total_budget_dollars' placeholder='Budget'/>").val(storage.budget));
        $addBox.append($("<input class='cpm' name='bid_dollars' placeholder='Bid CPM'/>").val(storage.cpm));
        $addBox.append($("<input type='button' value='Submit' />").click($.proxy(function() {
            var data = {
                'link_id36':this.id,
                'targeting':'one',
                'country':'US',
                'cost_basis':'cpm',
                'is_new':'true',
                'campaign_id36':'',
                'campaign_name':'',
                'id':'%23campaign',
                'uh':'17jivkneby63b5ae170baa293423c3f036510c2c5d77c2f9fa',
                'renderstyle':'html'
            };
            $addBox.find("input").each($.proxy(function(_,e) {
                var $el = $(e);
                var name = $el.attr("name");
                if (!name) return;
                var val = $el.val();
                data[name] = val;
            },this));
            data['impressions'] = parseInt(data['total_budget_dollars'])*500;

            $.post("https://www.reddit.com/api/edit_campaign",data,$.proxy(function() {
                this.fetchCampaignInfo();
            },this));
        },this)));
        this.$campaignField.empty().append($addBox);
    },
    fetchCampaignInfo:function() {
        $.get("https://www.reddit.com/promoted/edit_promo/"+this.id,$.proxy(function(html) {
            var $html = $(html);
            var campaignList = [];
            $html.find(".campaign-row").each(function() {
                var campaignInfo = {
                    startdate:$(this).data("startdate"),
                    enddate:$(this).data("enddate"),
                    subreddit:$(this).data("targeting"),
                    country:$(this).data("country"),
                    link_id:$(this).data("link_id36"),
                    campaign_id:$(this).data("campaign_id36"),
                    complete:$(this).data("has-served"),
                    budget:$(this).data("total_budget_dollars"),
                    cost_basis:$(this).data("cost_basis"),
                    bid:$(this).data("bid_dollars"),
                    live:$(this).data("is_live"),
                    pay_me:$(this).find("button.pay").text() === "pay",
                };
                campaignList.push(campaignInfo);

            });

            this.campaignList = campaignList;

            if (!hasRequestedPaymentInfo && this.campaignList.length > 0) {
                //request payment information
                var ret = GM_xmlhttpRequest({
                    method: "GET",
                    url: "https://www.reddit.com/promoted/pay/"+this.campaignList[0].link_id+"/"+this.campaignList[0].campaign_id,
                    onload: $.proxy(this.processPaymentMethods,this)
                });

                hasRequestedPaymentInfo = true;
            }

            this.$el.find(".subreddit_field").val(this.campaignList[0].subreddit);

            this.displayCampaignTable();
        },this));
    },
    processPaymentMethods:function(res) {
        var $el = $(res.responseText);

        var accounts = [];
        $el.find("select[name='account'] option").each(function() {
            if ($(this).val() != "0") {
                accounts.push({
                    name:$(this).text(),
                    id:$(this).val(),
                });
            }
        });
        this.accounts = accounts;

        customer_id = $el.find("input[name='customer_id']").val();
        accountSelect = $el.find("select[name='account']").attr("onchange","");
        accountSelect.change($.proxy(function() {
            var val = accountSelect.val();
            $("button.pay").each($.proxy(function(index,el) {
                this.updatePayButton($(el));
            },this));
            storage.selectedAccount = val;
            saveStorage();
        },this));
        $(".menuarea").append(accountSelect);
        if (storage.selectedAccount) accountSelect.val(storage.selectedAccount);

        $("button.pay").each($.proxy(function(index,el) {
            this.updatePayButton($(el));
        },this));
    },
    fetchTrafficInfo:function() {
        $.get("https://www.reddit.com/traffic/"+this.id,$.proxy(function(html) {
            var $html = $(html);

            var trafficTable = parseTable($html.find(".traffic-table").first());

            var trafficInfo = {};
            for (var i=0; i<trafficTable.length; i++) {
                var rowData = trafficTable[i];
                var id = rowData['id'];
                trafficInfo[id] = {
                    spent:rowData['spent'],
                    imps_delivered:rowData['imps delivered'],
                    clicks:rowData['clicks'],
                    ctr:rowData['ctr'],
                    cpc:rowData['cpc']
                }
            }

            this.trafficInfo = trafficInfo;

            this.displayCampaignTable();
        },this));
    },
    displayCampaignTable:function() {
        if (!this.trafficInfo || !this.campaignList) return;

        for (var i=0; i<this.campaignList.length; i++) {
            var campaign = this.campaignList[i];
            $.extend(campaign,this.trafficInfo[campaign.campaign_id]);
        }

        this.$el.find(".existing-campaigns").remove();

        var displayedValues = ['campaign_id','startdate','enddate','subreddit','country','budget','spent','clicks','ctr','cpc'];

        var $div = $("<div class='existing-campaigns' />");
        var $table = $("<table />").appendTo($div);
        var $headerRow = $("<tr class='campaign-header-row' />").appendTo($table);
        for (var i=0; i<displayedValues.length; i++) {
            var key = displayedValues[i];
            $("<th />").text(key).appendTo($headerRow);
        }

        for (var i=0; i<this.campaignList.length; i++) {
            var campaign = this.campaignList[i];
            var $tr = $("<tr class='campaign-row' />").appendTo($table);
            if (campaign.pay_me) $tr.addClass("payme");
            for (var l=0; l<displayedValues.length; l++) {
                var key = displayedValues[l];
                var $td = $("<td />").text(campaign[key]).appendTo($tr);

                if (key == "spent" && campaign.pay_me) {
                    var $button = $("<button class='pay'></button>");
                    this.updatePayButton($button);
                    var link_id = campaign.link_id;
                    var campaign_id = campaign.campaign_id;
                    $button.click($.proxy(function() {
                        this.payCampaign(link_id,campaign_id);
                    },this));
                    $td.append($button);
                }
            }
        }

        this.$campaignInfo.empty().append($div);
    },
    updatePayButton:function($el) {
        if (!accountSelect) {
            $el.hide();
            return;
        } else {
            $el.show();
        }

        var account = accountSelect.val();
        var text = accountSelect.find("[value='"+account+"']").text();
        var cardEnding = text.split("XXXX")[1];
        $el.text("Authorize payment: *"+cardEnding);
    },
    payCampaign:function(link_id,campaign_id) {
        if (!accountSelect) return;

        var account = accountSelect.val();
        console.log("paying campaign",link_id,campaign_id,account);

        window.open("https://pay.reddit.com/promoted/pay/"+link_id+"/"+campaign_id+"#autopay-"+account);
        setTimeout($.proxy(this.fetchCampaignInfo,this),5000);

        /*
        var data = {
            campaign:campaign_id,
            link:link_id,
            account:account,
            customer_id:customer_id,
            id:"#pay-form",
            uh:"61uuzm3foiec084f930da915bf1fd417e42efeedb29f0c4d94",
            renderstyle:"html"
        };

        console.log("posting data",data);

        var ret = GM_xmlhttpRequest({
            method: "POST",
            data:$.param(data),
            url: "https://pay.reddit.com/api/update_pay",
            //onload: $.proxy(this.fetchCampaignInfo,this),
            onload: function() {
                console.log("loaded!");
                console.log(ret.responseText);
            },
            onerror: function() {
                console.log("error!",arguments);
            },
        });
        console.log("posted data!");
        */
    },
    addArchiveButton:function() {
        var $li = $("<li><a href='#'>archive</a></li>");
        this.$el.find("ul.flat-list.buttons").append($li);
        $li.find("a").click($.proxy(function(e) {
            e.preventDefault();
            storage.archived.push(this.id);
            saveStorage();
            this.$el.hide();
        },this));
    }
});

function addMenuItem($menu,$el) {
    $menu.append($("<li />").append($el));
}


if (window.location.hostname == "pay.reddit.com") {
    if (!window.location.hash) return;
    var hash = window.location.hash.substring(1);
    console.log("has hash: ",hash);
    var tokens = hash.split("-");
    if (tokens.length == 2 && tokens[0] == "autopay") {
        var account = tokens[1];
        $("select[name='account']").val(account).get(0).onchange();
        $("button[type='submit']").filter(":visible").click()
    }
} else {
    var promoted = [];
    $(".promotedlink").each(function() {
        var $el = $(this);
        //if (promoted.length >= 1) return;
        var link = new Promoted($el);
        if (link.hidden) return;
        promoted.push(link);
    });


    var $menuArea = $(".menuarea");
    var $rightMenu = $("<ul class='flat-list campaignDefaults' style='float:right;' />");
    $menuArea.append($rightMenu);
    addMenuItem($rightMenu,$("<input class='startdate_master' value='"+storage.startDate+"'/>").change(function(e) {
        $(".startdate").val($(this).val());
        storage.startDate = $(this).val();
        saveStorage();
    }));

    addMenuItem($rightMenu,$("<input class='enddate_master' value='"+storage.endDate+"'/>").change(function(e) {
        $(".enddate").val($(this).val());
        storage.endDate = $(this).val();
        saveStorage();
    }));

    addMenuItem($rightMenu,$("<input class='budget_master' value='"+storage.budget+"'/>").change(function(e) {
        $(".budget").val($(this).val());
        storage.budget = $(this).val();
        saveStorage();
    }));

    addMenuItem($rightMenu,$("<input class='cpm_master' value='"+storage.cpm+"'/>").change(function(e) {
        $(".cpm").val($(this).val());
        storage.cpm = $(this).val();
        saveStorage();
    }));
}

//http://stackoverflow.com/questions/4376431/javascript-heredoc
function heredoc (f) {
    return f.toString().match(/\/\*\s*([\s\S]*?)\s*\*\//m)[1];
};

$(document.body).append(heredoc(function(){/*
<style type='text/css'>

.campaignAddendum {
    background: white;
    margin: 0px 10px;
    border-radius: 5px;
    margin-bottom: 17px;
}

.payme {
    background-color: #FFC154;
}

.existing-campaigns th { font-weight: bold; }
.existing-campaigns>table { margin: 0px; }

.addBox:before {
    content: 'Create Campaign: ';
    font-weight: bold;
}

.campaignField {
    padding: 5px;
}

.campaignDefaults:before {
    content: 'Defaults: ';
    font-weight: bold;
}

</style>
*/}));


